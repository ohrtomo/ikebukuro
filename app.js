// ==== Utility: Haversine distance (meters) ====
function haversine(lat1, lon1, lat2, lon2) {
	const R = 6371000;
	const toRad = (x) => (x * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

// ==== Global state ====
const state = {
    datasets: {
        stations: null,
        types: [],
        dests: [],
        trainTable: [],
        carIcons: {},
        platforms: null,   // ★ 追加: 発着番線データ
        stationIds: null,   // ★ 追加: 駅IDマスタ
        nonPassengerTypes: null,   // ★ 追加：回送/臨時の細分類
    },
    config: {
        direction: "上り",
        type: "",
        dest: "",
        cars: 10,
        trainNo: "",
        endChange: false,

        second: {
            type: "",
            dest: "",
            cars: 10,
            trainNo: "",
            changeStation: "",   // ★ 追加：変更となる駅
        },

        voiceVolume: 1.0,
        dayType: "平日",
    },

    runtime: {
        started: false,
        lastSpoken: {},
        lastStopStation: null,
        lastPosition: null,
        speedKmh: 0,
        passStations: new Set(),
        platformChanges: new Set(),
        manualTrainNo: null,
        manualTrainChangeAt: null,
        lastStopDistance: null,
        prevStationName: null,
        prevStationDistance: null,
        prevDistances: {},
        routeLocked: false,
        routeLine: null,

        muteUntil: 0,
        lastDepartStation: null,
        lastDepartPrevDist: null,
        manualPlatforms: {},
        startupMode: false,         // 起動モード中かどうか
        startupFixed: false,        // 起動モードで一度「現在駅」を確定したか
        startupCandidate: null,     // 起動判定中の候補駅名
        startupCount: 0,            // 同じ駅を何回連続で見たか  
        voiceMuted: false,          // 一時ミュートフラグ

        nonPassengerExtraStops: new Set(),        // 現在有効なセット（1本目 or 2本目）
        nonPassengerExtraStopsSecond: new Set(),  // 変更後列車用

        // 追加停車駅設定用キュー
        extraStopsQueue: [],
        extraStopsMode: null,   // "first" or "second"

        // ★ 途中駅列情変更用フラグ
        midChangePending: false,          // まだこれから途中駅で列情変更を行う
        midChangeApplied: false,          // 途中駅列情変更を論理的に適用済み（以降は後の列車）
        midChangeArrivalHandled: false,   // 変更駅到着時のUI更新を済ませたか
        midChangeConfirmTimer: null,      // 15秒後の「列情確認」タイマー
        midChangeTriggerStation: null,    // ★ どの駅の190m通過で列情を切り替えるか

        undergroundMode: false,               // 地下モード中かどうか
        undergroundLastToStationName: null,   // trains API の最新 toStationName
        undergroundSource: null,              // "downButton" / "autoUp" / "menu" など任意
        autoUndergroundReady: false,   // ★ 上り(練馬→有楽町線) 自動地下切替待機
        lastGpsUpdate: 0,              // ★ GPS更新時刻（色判定用）
        speedOutlierStreak: 0,   // ★ 追加：外れ値が連続した回数
    },
};

// ==== Load datasets ====
async function loadData() {
    const [
        stations,
        types,
        dests,
        ttable,
        carIcons,
        platforms,
        stationIds,
        nonPassengerTypes,  
    ] = await Promise.all([
        fetch("./data/stations.json").then((r) => r.json()),
        fetch("./data/types.json").then((r) => r.json()),
        fetch("./data/destinations.json").then((r) => r.json()),
        fetch("./data/train_number_table.json").then((r) => r.json()),
        fetch("./data/car_icons.json").then((r) => r.json()),
        fetch("./data/platform.json").then((r) => r.json()),
        fetch("./data/stationID.json").then((r) => r.json()),
        fetch("./data/nonpassenger_types.json").then((r) => r.json()),
    ]);

    state.datasets.stations    = stations;
    state.datasets.types       = types;
    state.datasets.dests       = dests;
    state.datasets.trainTable  = ttable;
    state.datasets.carIcons    = carIcons;
    state.datasets.platforms   = platforms;
    state.datasets.stationIds  = stationIds;
    state.datasets.nonPassengerTypes = nonPassengerTypes; 
}

// ==== Speech ====
function speakOnce(key, text) {
    const rt = state.runtime;
    if (!rt.started) return;

    // ★追加：地下モード中は地下モード専用の音声（ug_）以外を禁止
    if (rt.undergroundMode) {
        const k = String(key || "");
        if (!(k.startsWith("ug_") || k.startsWith("test_volume_"))) return;
    }

    if (rt.voiceMuted) return;
    if (rt.muteUntil && Date.now() < rt.muteUntil) return;

    const now = Date.now();

    // ★ 案内開始前（start画面・設定画面など）では一切しゃべらない
    //   ただし "start_guidance" は案内開始後に使うので例外扱い
    if (!state.runtime.started && key !== "start_guidance") {
        return;
    }

    // ★ 案内開始から10秒間は「start_guidance」以外の音声をミュート
    if (
        key !== "start_guidance" &&
        state.runtime.muteUntil &&
        now < state.runtime.muteUntil
    ) {
        return;
    }

    const last = state.runtime.lastSpoken[key] || 0;
    if (now - last < 30000) return; // 30秒抑止
    state.runtime.lastSpoken[key] = now;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";

    // ★ 音量反映（0.0〜1.0）＋一時ミュート
    let vol = state.config.voiceVolume;

    // 「音声停止」ボタン押下中は強制 0
    if (state.runtime.voiceMuted) {
        vol = 0;
    }

    utter.volume =
        typeof vol === "number" ? Math.min(Math.max(vol, 0), 1) : 1.0;

    speechSynthesis.speak(utter);

    const root = document.getElementById("screen-guidance");
    if (root && root._speechText) {
        root._speechText.textContent = text;
    }
}

// ★ 列車番号と運転日区分から「回送A」「臨時B」などを取得
function getNonPassengerTypeByTrainNo(trainNo) {
    const map = state.datasets.nonPassengerTypes;
    if (!map) return null;

    const dayType = state.config.dayType || "平日";  // 「平日」「土休日」
    const table = map[dayType];
    if (!table) return null;

    const key = String(trainNo).trim();
    return table[key] || null;  // 該当なしなら null
}

// ★ 「回送A」＋方向 → 種別一覧にある正式名称へ変換
//    例: base="回送A", direction="上り" → "回送A上"（types.json に存在する場合）
function resolveNonPassengerDisplayType(base, direction) {
    if (!base) return null;
    const typesList = state.datasets.types || [];
    const dirSuffix = direction === "上り" ? "上" : "下";

    // 回送系：まず「回送A上/下」が types にあるか確認
    if (/^回送/.test(base)) {
        const cand = base + dirSuffix;          // 例: 回送A上
        if (typesList.includes(cand)) {
            return cand;
        }
    }

    // 「臨時A」や「回送I」「回送J」など、方向を付けないもの
    if (typesList.includes(base)) {
        return base;
    }

    // どうしても見つからなければ、そのまま返す（安全側）
    return base;
}

// ==== Train number parser ====
// 対応: 「開始〜終了」範囲 && 奇数→右 / 偶数→左 行先
// 偶数→上り / 奇数→下り
function parseTrainNo(trainNo) {
    const n = parseInt(String(trainNo), 10);
    if (Number.isNaN(n)) return null;
    let found = null;

    for (const row of state.datasets.trainTable) {
        const start = parseInt(row["列車番号"], 10);
        const end   = parseInt(row["Unnamed: 1"], 10);
        if (!Number.isNaN(start) && !Number.isNaN(end) && n >= start && n <= end) {

            let type = row["種別"] || "";

            // 左側: 行先 / 右側: Unnamed: 4
            const destLeft  = row["行先"]   || "";
            const destRight = row["Unnamed: 4"] || "";

            // 偶数→左側（上り系） / 奇数→右側（下り系）
            const dest = n % 2 === 0 ? destLeft : destRight;

            // 偶数→上り / 奇数→下り
            const direction = n % 2 === 0 ? "上り" : "下り";

            // ★ 回送／臨時／試運転なら、別表４から細分類を取得して種別名を上書き
            if (/(回送|臨時|試運転)/.test(type)) {
                const baseSub = getNonPassengerTypeByTrainNo(n); // 例: "回送A", "臨時B"
                if (baseSub) {
                    // 「種別一覧(types.json)に存在する正式名称」に変換
                    type = resolveNonPassengerDisplayType(baseSub, direction);
                }
            }

            // ★ 最終的に表示・判定に使う種別名を正規化
            type = normalizeTypeName(type);

            found = { type, dest, direction };
        }
    }
    return found;
}

// ==== Element creation helper ====
function el(tag, attrs = {}, children = []) {
	// attrsが配列の場合、childrenとして扱う（属性省略パターン）
	if (Array.isArray(attrs)) {
		children = attrs;
		attrs = {};
	}

	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") e.className = v;
		else if (k === "text") e.textContent = v;
		else if (k.startsWith("on") && typeof v === "function")
			e.addEventListener(k.substring(2), v);
		else if (typeof k === "string" && k && v != null) e.setAttribute(k, v);
	}
	(Array.isArray(children) ? children : [children]).forEach((c) => {
		if (typeof c === "string") e.appendChild(document.createTextNode(c));
		else if (c) e.appendChild(c);
	});
	return e;
}

// ==== 日本の祝日判定 ====

// 春分の日（だいたい 3/20 前後）、秋分の日（だいたい 9/23 前後）
// 2000〜2099年向けの近似式
function vernalEquinoxDay(year) {
    // 2000〜2099 年の近似式
    return Math.floor(
        20.8431 +
        0.242194 * (year - 1980) -
        Math.floor((year - 1980) / 4)
    );
}

function autumnEquinoxDay(year) {
    // 2000〜2099 年の近似式
    return Math.floor(
        23.2488 +
        0.242194 * (year - 1980) -
        Math.floor((year - 1980) / 4)
    );
}

// 月内の「第 n ○曜日」を返すヘルパー（例: 第2月曜など）
function nthWeekdayOfMonth(year, month, weekday, nth) {
    // month: 1〜12, weekday: 0(日)〜6(土), nth: 1,2,3...
    const first = new Date(year, month - 1, 1);
    const firstW = first.getDay();
    let day = 1 + ((7 + weekday - firstW) % 7) + (nth - 1) * 7;
    return day;
}

// 「元々の祝日」（振替休日や国民の休日を含まない）を判定
function isBaseJapaneseHoliday(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1; // 1〜12
    const d = date.getDate();

    // 固定日
    if (m === 1 && d === 1) return true;      // 元日
    if (m === 2 && d === 11) return true;     // 建国記念の日
    if (m === 2 && d === 23 && y >= 2020) return true; // 天皇誕生日（令和）
    if (m === 4 && d === 29) return true;     // 昭和の日
    if (m === 5 && d === 3) return true;      // 憲法記念日
    if (m === 5 && d === 4) return true;      // みどりの日
    if (m === 5 && d === 5) return true;      // こどもの日
    if (m === 8 && d === 11 && y >= 2016) return true; // 山の日
    if (m === 11 && d === 3) return true;     // 文化の日
    if (m === 11 && d === 23) return true;    // 勤労感謝の日

    // ハッピーマンデー制の祝日
    // 成人の日: 1月第2月曜
    if (m === 1 && d === nthWeekdayOfMonth(y, 1, 1, 2)) return true;
    // 海の日: 7月第3月曜
    if (m === 7 && d === nthWeekdayOfMonth(y, 7, 1, 3)) return true;
    // 敬老の日: 9月第3月曜
    if (m === 9 && d === nthWeekdayOfMonth(y, 9, 1, 3)) return true;
    // スポーツの日: 10月第2月曜
    if (m === 10 && d === nthWeekdayOfMonth(y, 10, 1, 2)) return true;

    // 春分の日
    if (m === 3 && d === vernalEquinoxDay(y)) return true;
    // 秋分の日
    if (m === 9 && d === autumnEquinoxDay(y)) return true;

    return false;
}

// 祝日 + 振替休日 + 国民の休日 をまとめて判定
function isJapaneseHoliday(date) {
    // まず元の祝日そのもの
    if (isBaseJapaneseHoliday(date)) return true;

    const wd = date.getDay(); // 0(日)〜6(土)

    // 振替休日（簡易版）
    // ・今回の日が月〜水あたりで、
    // ・1日前が祝日かつ日曜日、なら振替休日とみなす
    if (wd >= 1 && wd <= 3) {
        const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
        if (isBaseJapaneseHoliday(prev) && prev.getDay() === 0) {
            return true;
        }
    }

    // 国民の休日（簡易版）
    // ・火〜木で、前日と翌日が祝日の場合
    if (wd >= 2 && wd <= 4) {
        const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        if (isBaseJapaneseHoliday(prev) && isBaseJapaneseHoliday(next)) {
            return true;
        }
    }

    return false;
}

// ==== Screens ====
function screenSettings() {
	const root = el("div", { class: "screen active", id: "screen-settings" });
	const c = el("div", { class: "container" });

	// 列車番号（前）
	const trainNo = el("input", {
		type: "text",
		placeholder: "4桁の列車番号",
		id: "trainNo",
	});

	// 検索ボタン（前半用）
	const btnSearch = el("button", { class: "btn" }, "検索");

	// ---- 上り/下り（方向ボタン） ----
	let selectedDir = ""; // 初期値

	const dirButtons = el("div", { class: "grid2" }, [
		(() => {
			const btn = el(
				"button",
				{
					class: "btn secondary",
					type: "button",
					"data-dir": "上り",
				},
				"上り",
			);
			btn.onclick = () => {
				selectedDir = "上り";
				dirButtons.querySelectorAll("button").forEach((b) =>
					b.classList.remove("active-selected"),
				);
				btn.classList.add("active-selected");
			};
			return btn;
		})(),
		(() => {
			const btn = el(
				"button",
				{
					class: "btn secondary",
					type: "button",
					"data-dir": "下り",
				},
				"下り",
			);
			btn.onclick = () => {
				selectedDir = "下り";
				dirButtons.querySelectorAll("button").forEach((b) =>
					b.classList.remove("active-selected"),
				);
				btn.classList.add("active-selected");
			};
			return btn;
		})(),
	]);

	// 種別（前）
	const typeSel = el("select", { id: "type" });
	typeSel.appendChild(el("option", { value: "" }, ""));  // ★ 未選択用

	state.datasets.types.forEach((t) => {
		typeSel.appendChild(el("option", { value: t }, t));
	});

	// 行先（前）
	const destSel = el("select", { id: "dest" });
	destSel.appendChild(el("option", { value: "" }, ""));  // ★ 未選択用
	state.datasets.dests.forEach((d) => {
		destSel.appendChild(el("option", { value: d }, d));
	});

	// ★ 変更となる駅（途中で列情変更する駅）
	const changeStationSel = el("select", { id: "changeStation" });
	changeStationSel.appendChild(el("option", { value: "" }, ""));
	state.datasets.dests.forEach((d) => {
		changeStationSel.appendChild(el("option", { value: d }, d));
	});

	// 行先を変更したら、「変更となる駅」が未選択または
	// もともと行先と一致していた場合は、自動で追従させる
	destSel.onchange = () => {
		if (!changeStationSel.value || changeStationSel.value === state.config.dest) {
			changeStationSel.value = destSel.value || "";
		}
	};

    // ---- 運転日区分（平日 / 土休日） ----
    const dayTypeSel = el("select", { id: "dayType" });
    dayTypeSel.appendChild(el("option", { value: "平日" }, "平日"));
    dayTypeSel.appendChild(el("option", { value: "土休日" }, "土休日"));

    // ★ 起動時に今日の日付から自動判定
    (function autoSelectDayType() {
        const today = new Date();
        const wd = today.getDay(); // 0:日曜, 1:月曜, ... 6:土曜
        const m  = today.getMonth() + 1; // 1〜12
        const d  = today.getDate();

        // 祝日 or 土日
        const isHol = isJapaneseHoliday(today);
        const isWeekend = (wd === 0 || wd === 6);

        // ★ 年末年始の特例：12/30〜1/2 は「土休日」扱い
        const isYearEndNewYear =
            (m === 12 && d >= 30) ||   // 12/30, 12/31
            (m === 1  && d <= 2);     // 1/1, 1/2

        const autoDayType =
            (isHol || isWeekend || isYearEndNewYear) ? "土休日" : "平日";

        // 設定にも反映
        state.config.dayType = autoDayType;
        // セレクトボックスにも反映
        dayTypeSel.value = autoDayType;
    })();


	// ---- 両数（前）：10 / 8 / 7 / 6 / 4 / 2 ボタン選択 ----
	const carsValues = [10, 8, 7, 6, 4, 2];
	let selectedCars = null; // 初期値
	let carsLabel2 = null; // 後半表示用ラベル（あとで代入）

	const carsButtons = el(
		"div",
		{ class: "grid2" },
		carsValues.map((v) => {
			const btn = el(
				"button",
				{
					class:
						"btn secondary" +
						(v === selectedCars ? " active-selected" : ""),
					type: "button",
				},
				`${v}両`,
			);
			btn.onclick = (e) => {
				selectedCars = v;

				// 前半ボタンの見た目更新
				carsButtons.querySelectorAll("button").forEach((b) => {
					b.classList.remove("active-selected");
				});
				e.currentTarget.classList.add("active-selected");

				// 後半の両数表示も同期（編集はさせない）
				if (carsLabel2) {
					carsLabel2.textContent = `${selectedCars}両`;
				}
			};
			return btn;
		}),
	);

	// ---- 途中駅で列情変更 ON/OFF ----
	const endChange = el("input", { type: "checkbox", id: "endChange" });
	const secondWrap = el("div", { id: "secondConfig", style: "display:none;" });

	endChange.onchange = () => {
		secondWrap.style.display = endChange.checked ? "block" : "none";
		if (endChange.checked) {
			// ★ チェックを入れた瞬間に「変更となる駅」を行先で初期化
			if (destSel.value) {
				changeStationSel.value = destSel.value;
			}
		}
	};

	// ---- 後半：列番・種別・行先（両数は固定で表示のみ） ----
	const trainNo2 = el("input", { type: "text" });

	const typeSel2 = el("select");
	typeSel2.appendChild(el("option", { value: "" }, "")); // ★

		state.datasets.types.forEach((t) => {
		typeSel2.appendChild(el("option", { value: t }, t));
	});

	const destSel2 = el("select");
	destSel2.appendChild(el("option", { value: "" }, ""));  // ★ 未選択用

	state.datasets.dests.forEach((d) => {
		destSel2.appendChild(el("option", { value: d }, d));
	});


	// ★ 後半：列番から種別・行先を検索するボタン
	const btnSearch2 = el(
		"button",
		{ class: "btn secondary", type: "button" },
		"検索",
	);
	btnSearch2.onclick = () => {
		const res = parseTrainNo(trainNo2.value.trim());
		if (res) {
			typeSel2.value = res.type;
			destSel2.value = res.dest;
		} else {
			alert("列番表に該当がありません。手動で選択してください。");
		}
	};

	// ★ 後半両数は「表示だけ」：元の列車の両数を引き継ぐ
	carsLabel2 = el("span", { id: "cars2Label" }, `${selectedCars}両`);

	secondWrap.append(
		el("div", { class: "row" }, [
			el("label", {}, "列番(後)"),
			trainNo2,
			btnSearch2,
		]),

		el("div", { class: "grid2" }, [
			el("div", {}, [el("label", {}, "種別(後)"), typeSel2]),
			el("div", {}, [el("label", {}, "行先(後)"), destSel2]),
		]),

            // ★ 変更となる駅
    	el("div", { class: "row" }, [
    	    el("label", {}, "変更となる駅"),
    	    changeStationSel,
    	]),

		// 両数(後) は入力欄をなくしてラベルだけ
		el("div", { class: "row" }, [el("label", {}, "両数(後)"), carsLabel2]),
	);

	// ---- 検索ボタンの挙動（前半：列車番号 → 種別・行先・方向） ----
	btnSearch.onclick = () => {
		const res = parseTrainNo(trainNo.value.trim());
		if (res) {
			typeSel.value = res.type;
			destSel.value = res.dest;

			// 方向（上り/下り）をボタンに反映
			if (res.direction === "上り" || res.direction === "下り") {
				selectedDir = res.direction;
				dirButtons.querySelectorAll("button").forEach((b) =>
					b.classList.remove("active-selected"),
				);
				const target = dirButtons.querySelector(
					`button[data-dir="${selectedDir}"]`,
				);
				if (target) target.classList.add("active-selected");
			}
		} else {
			alert("列番表に該当がありません。手動で選択してください。");
		}
	};

    // ---- 実行ボタン ----
    const execBtn = el("button", { class: "btn" }, "実行");
    execBtn.onclick = () => {

        // --- ★ 必須チェック ---
        if (!trainNo.value.trim()) {
            alert("列車番号を入力してください。");
            return;
        }
        if (!selectedDir) {
            alert("上り/下りを選択してください。");
            return;
        }
        if (!typeSel.value) {
            alert("種別を選択してください。");
            return;
        }
        if (!destSel.value) {
            alert("行先を選択してください。");
            return;
        }
        if (!selectedCars) {
            alert("両数を選択してください。");
            return;
        }

        // --- ★ 途中駅で列情変更用のチェック ---
        if (endChange.checked) {
            if (!trainNo2.value.trim()) {
                alert("変更後の列車番号を入力してください。");
                return;
            }
            if (!typeSel2.value) {
                alert("変更後の種別を選択してください。");
                return;
            }
            if (!destSel2.value) {
                alert("変更後の行先を選択してください。");
                return;
            }
            if (!changeStationSel.value) {
                alert("変更となる駅を選択してください。");
                return;
            }

            const n1 = parseInt(trainNo.value.trim(), 10);
            const n2 = parseInt(trainNo2.value.trim(), 10);
            if (Number.isNaN(n1) || Number.isNaN(n2)) {
                alert("列車番号が正しくありません。");
                return;
            }
            // ★ 偶数同士／奇数同士でなければエラー（方向が一致していない）
            if ((n1 % 2 + 2) % 2 !== (n2 % 2 + 2) % 2) {
                alert("変更前と変更後の列車番号は、同じ方向（偶数/奇数）にしてください。");
                return;
            }
        }

        // --- ★ 必須チェックここまで ---

        // 前半設定
        state.config.trainNo   = trainNo.value.trim();
        state.config.direction = selectedDir;
        state.config.type      = typeSel.value;
        state.config.dest      = destSel.value;
        state.config.cars      = selectedCars;
        state.config.dayType   = dayTypeSel.value || "平日";
        state.config.type      = normalizeTypeName(typeSel.value);        

        // 途中駅で列情変更
        state.config.endChange = endChange.checked;
        if (endChange.checked) {
            state.config.second.trainNo       = trainNo2.value.trim();
            state.config.second.type          = typeSel2.value;
            state.config.second.dest          = destSel2.value;
            state.config.second.cars          = state.config.cars;
            state.config.second.changeStation = changeStationSel.value;

            // ★ runtime 初期化
            state.runtime.midChangePending        = true;
            state.runtime.midChangeApplied        = false;
            state.runtime.midChangeArrivalHandled = false;
            if (state.runtime.midChangeConfirmTimer) {
                clearTimeout(state.runtime.midChangeConfirmTimer);
                state.runtime.midChangeConfirmTimer = null;
            }
        } else {
            state.runtime.midChangePending        = false;
            state.runtime.midChangeApplied        = false;
            state.runtime.midChangeArrivalHandled = false;
            if (state.runtime.midChangeConfirmTimer) {
                clearTimeout(state.runtime.midChangeConfirmTimer);
                state.runtime.midChangeConfirmTimer = null;
            }
        }

        // ★ ここから遷移分岐
        const nonPassengerFirst  = isNonPassenger(state.config.type);
        const nonPassengerSecond =
            state.config.endChange && isNonPassenger(state.config.second.type);

        // 追加停車駅設定キューを構築
        state.runtime.extraStopsQueue = [];
        if (nonPassengerFirst)  state.runtime.extraStopsQueue.push("first");
        if (nonPassengerSecond) state.runtime.extraStopsQueue.push("second");

        // 設定画面を一旦閉じる
        document
            .getElementById("screen-settings")
            .classList.remove("active");

        if (state.runtime.extraStopsQueue.length > 0) {
            // 追加停車駅設定からスタート
            const mode = state.runtime.extraStopsQueue.shift();
            state.runtime.extraStopsMode = mode;
            renderNonPassengerExtraStopsScreen();
            document
                .getElementById("screen-extra-stops")
                .classList.add("active");
        } else {
            // 回送・試運転・臨時が一切ない場合 → そのまま開始画面へ
            startGpsWatch();
            document
                .getElementById("screen-start")
                .classList.add("active");

            // ★ 下り列車なら「地下起動」ボタンを表示
            const startRoot = document.getElementById("screen-start");
            if (startRoot && startRoot._updateUndergroundButtonVisibility) {
                startRoot._updateUndergroundButtonVisibility();
            }
        }
    }


    // ---- 画面にパーツを配置 ----
    c.append(
        el("div", { class: "row" }, [
            el("label", {}, "列車番号"),
            trainNo,
            btnSearch,
        ]),
        el("div", { class: "grid2" }, [
            el("div", [el("label", {}, "上り/下り"), dirButtons]),
            el("div", [el("label", {}, "両数"), carsButtons]),
        ]),
        el("div", { class: "grid2" }, [
            el("div", [el("label", {}, "種別"), typeSel]),
            el("div", [el("label", {}, "行先"), destSel]),
        ]),
        // ★ ここから追加: 運転日
        el("div", { class: "row" }, [
            el("label", {}, "運転日"),
            dayTypeSel,
        ]),
        // ★ ここまで追加
        el("div", { class: "row endchange-row" }, [
            endChange,
            el("span", {}, " 途中駅で列情変更"),
        ]),
        secondWrap,
        execBtn,
    );

    root.appendChild(c);
    return root;
}

function screenStart() {
    const root = el("div", { class: "screen", id: "screen-start" });

    const btnBegin = el("button", { class: "btn", id: "btn-begin" }, "開始");
    const btnCancel = el("button", { class: "btn secondary", id: "btn-cancel" }, "中止");

    // ★ 下り列車専用「地下起動」ボタン（赤）
    const btnUnderground = el(
        "button",
        {
            class: "btn warn",
            id: "btn-underground-start",
            style: "display:none;",   // 初期は非表示
        },
        "地下起動",
    );

    const center = el("div", { class: "centered" }, [
        btnBegin,
        btnCancel,
        btnUnderground,
    ]);

    // ★ 開始画面にも GPS 状態表示欄を追加
    const gpsNotes = el("div", { class: "notes", id: "gpsStatusStart" }, "");

    root.append(center, gpsNotes);

    // screen-start 用の参照
    root._gpsStatus = gpsNotes;
    root._btnUnderground = btnUnderground;

    // ★ 設定された方向に応じて「地下起動」ボタンの表示/非表示を切り替えるヘルパー
    root._updateUndergroundButtonVisibility = () => {
        const isDown = state.config.direction === "下り";
        if (root._btnUnderground) {
            root._btnUnderground.style.display = isDown ? "inline-block" : "none";
        }
    };

    // 初期状態反映
    root._updateUndergroundButtonVisibility();

    root.onclick = (e) => {
        if (e.target.id === "btn-begin") {
            // ダイヤ上の基本停車駅から通過駅リストを構築
            buildPassStationList();

            // ★ 案内開始から10秒間は他の案内をミュート
            state.runtime.muteUntil = Date.now() + 10000;

            document.getElementById("screen-start").classList.remove("active");
            document.getElementById("screen-guidance").classList.add("active");
            startGuidance();

        } else if (e.target.id === "btn-cancel") {
            document.getElementById("screen-start").classList.remove("active");
            document.getElementById("screen-settings").classList.add("active");

        } else if (e.target.id === "btn-underground-start") {
            // ★ 地下起動ボタン：有楽町線地下モードで案内開始（下り列車想定）
            buildPassStationList();

            state.runtime.muteUntil = Date.now() + 10000;

            // 地下モード開始（下り用）
            enterUndergroundMode("downButton");

            document.getElementById("screen-start").classList.remove("active");
            document.getElementById("screen-guidance").classList.add("active");
            startGuidance();
        }
    };

    return root;
}

function normalizeTypeName(t) {
    if (!t) return t;
    const s = String(t).trim();

    // ★ SトレBの旧表記を統一
    if (s === "SトレB上" || s === "SトレB下") return "SトレB";

    return s;
}

function typeClass(t) {
    const tt = normalizeTypeName(t);

    if (tt === "特急") return "j-tokkyu";
    if (tt === "SトレA" || tt === "SトレB") return "j-storea";
    if (tt === "快速急行" || tt === "地下快急") return "j-kaisokukyuko";
    if (tt === "急行") return "j-kyuko";
    if (tt === "通勤急行") return "j-tsukin_kyuko";
    if (tt === "快速") return "j-kaisoku";
    if (tt === "準急") return "j-junkyu";
    if (tt === "通勤準急") return "j-tsukin_junkyu";
    if (tt === "区間準急") return "j-kukan_junkyu";
    if (tt === "各停") return "j-kakutei";
    if (/回送|試運転/.test(tt)) return "j-kaiso";
    if (/臨時/.test(tt)) return "j-rinji-a";
    return "j-kakutei";
}

function band1RenderCars(elm, show, cars) {
    // ★ band1 内の「両数エリア」コンテナを取得
    let container = elm.querySelector(".band1-left .cars-wrapper");
    if (!container) {
        // 念のためフォールバック（古い構造の場合など）
        container = elm;
    }

    // 1. 既存の img.carIcon を探す。なければ新しく作る
    let img = container.querySelector(".carIcon");
    if (!img) {
        img = document.createElement("img");
        img.className = "carIcon";
        container.appendChild(img);
    }

    // 2. 両数に対応するアイコンファイルを取得
    const iconFile = state.datasets.carIcons[cars];

    // ファイルが見つからない場合は強制的に非表示扱い
    if (!iconFile) {
        show = false;
    } else {
        img.src = "./data/car_icons/" + iconFile;
    }

    // 3. 画像の visibility だけ切り替える
    img.style.visibility = show ? "visible" : "hidden";

    // （バンド自体は常に表示）
    elm.style.visibility = "visible";
}


function screenGuidance() {
    const root = el("div", { class: "screen guidance", id: "screen-guidance" });

    // --- Band1: 左=両数 / 右=種別（縦書き） ---
    const band1 = el("div", { class: "band band1" }, [
        el("div", { class: "band1-left cars-wrapper" }, [
            // 両数アイコン（band1RenderCars が img.carIcon を差し込む）
        ]),
        el("div", { class: "band1-right" }, [
            el("div", { id: "badgeType", class: "badge badge-vertical" }, ""),
        ]),
    ]);

    // --- Band2: GPS/速度 + 音声表示 ---
    const band2 = el("div", { class: "band band2" }, [
        el("div", { class: "notes gps-row" }, [
            el("span", { id: "gpsStatus" }, ""),
            el("span", { id: "gpsSpeed" }, ""),
        ]),
        el("div", { class: "notes speech", id: "speechText" }, ""),
    ]);

    // --- Band3: 左=列番+行先 / 右=駅間表示 ---
    // 駅間表示の id は、あなたが前回追加した表示ロジックに合わせてください。
    // （ここでは "betweenStations" に統一しています）
    const band3 = el("div", { class: "band band3" }, [
        el("div", { class: "band3-left" }, [
            el("div", { class: "traininfo" }, [
                el("div", { class: "cell", id: "cellNo" }, "----"),
                el("div", { class: "cell", id: "cellDest" }, "----"),
            ]),
        ]),
        el("div", { class: "band3-right" }, [
            el("div", { class: "notes segment", id: "segmentInfo" }, ""),
        ]),
    ]);

    // --- Band4: 発車時刻（旧 band6） ---
    const band4 = el("div", { class: "band band4" }, [
        el("div", { id: "nextDepart" }, ""),
    ]);

    // --- Band5: メニュー・音声停止・時計・遅延 ---
    const band5 = el("div", { class: "band band5" }, [
        el("div", { class: "menu-btn", id: "btnMenu" }, "≡"),
        el("button", { class: "btn secondary", id: "btnVoiceMute" }, "音声停止"),
        el("div", { class: "clock", id: "clock" }, "00:00:00"),
        el("div", { class: "clock", id: "delayInfo" }, ""),
    ]);

    // ★ 6段目（band6）は廃止：append しない
    root.append(band1, band2, band3, band4, band5);

    // Menu modal（従来通り）
    const modal = el("div", { class: "modal", id: "menuModal" }, [
        el("div", { class: "panel" }, [
            el("h3", {}, "メニュー"),
            el("div", { class: "list" }, [
                el("button", { class: "btn secondary", id: "m-end" }, "案内終了"),
                el("button", { class: "btn secondary", id: "m-stop" }, "臨時停車・通過"),
                el("button", { class: "btn secondary", id: "m-dest" }, "行先変更"),
                el("button", { class: "btn secondary", id: "m-type" }, "種別変更"),
                el("button", { class: "btn secondary", id: "m-train" }, "列番変更"),
                el("button", { class: "btn secondary", id: "m-volume" }, "音量設定・テスト"),
                el("button", { class: "btn secondary", id: "m-reset" }, "地点リセット"),
                el("button", { class: "btn secondary", id: "m-info" }, "運行情報"),
                el("button", { class: "btn secondary", id: "m-underground" }, "強制地下"),
                el("button", { class: "btn secondary", id: "m-close" }, "とじる"),
            ]),
        ]),
    ]);
    root.appendChild(modal);

    const panel = modal.querySelector(".panel");

    // ★ 各要素への参照
    root._band1       = band1;
    root._gpsStatus   = band2.querySelector("#gpsStatus");
    root._gpsSpeed    = band2.querySelector("#gpsSpeed");
    root._speechText  = band2.querySelector("#speechText");
    root._badgeType   = band1.querySelector("#badgeType");

    // ★ 3段目へ移動
    root._cellNo      = band3.querySelector("#cellNo");
    root._cellDest    = band3.querySelector("#cellDest");


    // ★ 駅間表示（地下中は非表示運用）
    root._segmentInfo = band3.querySelector("#segmentInfo"); // ★追加

    // ★ 発車時刻は 4段目へ
    root._nextDepart  = band4.querySelector("#nextDepart");

    root._clock       = band5.querySelector("#clock");
    root._delayInfo   = band5.querySelector("#delayInfo");
    root._btnVoiceMute = band5.querySelector("#btnVoiceMute");

    // --- メニュー開閉 ---
    band5.querySelector("#btnMenu").onclick = () => {
        modal.classList.add("active");
        panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
    };

    modal.onclick = (e) => {
        if (e.target.id === "menuModal") {
            modal.classList.remove("active");
            panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
        }
    };

    modal.querySelector("#m-end").onclick = () => {
        modal.classList.remove("active");
        stopGuidance();
        document.getElementById("screen-guidance").classList.remove("active");
        document.getElementById("screen-settings").classList.add("active");
    };

    modal.querySelector("#m-dest").onclick = () =>
        openList("行先変更", state.datasets.dests, (v) => {
            state.config.dest = v;
        });

    modal.querySelector("#m-type").onclick = () =>
        openList("種別変更", state.datasets.types, (v) => {
            state.config.type = normalizeTypeName(v);
        });

    modal.querySelector("#m-stop").onclick = () => openStopList();
    modal.querySelector("#m-train").onclick = () => openTrainChange();
    modal.querySelector("#m-volume").onclick = () => openVolumePanel();
    modal.querySelector("#m-info").onclick = () => openOperationInfo();

    modal.querySelector("#m-reset").onclick = () => {
        exitUndergroundMode(null);
        startStartupLocationDetection();
        modal.classList.remove("active");
        panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
    };

    modal.querySelector("#m-underground").onclick = () => {
        enterUndergroundMode("menu");
        modal.classList.remove("active");
        panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
    };

    modal.querySelector("#m-close").onclick = () => {
        modal.classList.remove("active");
        panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
    };

    // --- 音声停止トグル ---
    if (root._btnVoiceMute) {
        root._btnVoiceMute.onclick = () => {
            state.runtime.voiceMuted = !state.runtime.voiceMuted;
            if (state.runtime.voiceMuted) {
                root._btnVoiceMute.classList.add("muted");
            } else {
                root._btnVoiceMute.classList.remove("muted");
            }
        };
    }

    return root;
}

// ★ 自動地下待機中の GPS 点滅（黄/灰）
let gpsBlinkTimer = null;
let gpsBlinkOn = false;

function applyGpsBlinkColor() {
    const color = gpsBlinkOn ? "yellow" : "gray";

    const g = document.getElementById("screen-guidance");
    const s = document.getElementById("screen-start");

    if (g && g._gpsStatus) {
        g._gpsStatus.textContent = "GPS";
        g._gpsStatus.style.color = color;
    }
    if (s && s._gpsStatus) {
        s._gpsStatus.textContent = "GPS";
        s._gpsStatus.style.color = color;
    }

    // 速度欄は「待機中は表示したまま」で、色だけ合わせる（見た目統一）
    if (g && g._gpsSpeed) g._gpsSpeed.style.color = color;
    if (s && s._gpsSpeed) s._gpsSpeed.style.color = color;
}

function startGpsBlink() {
    if (gpsBlinkTimer) return;
    gpsBlinkOn = false;
    applyGpsBlinkColor();
    gpsBlinkTimer = setInterval(() => {
        gpsBlinkOn = !gpsBlinkOn;
        applyGpsBlinkColor();
    }, 500);
}

function stopGpsBlink() {
    if (gpsBlinkTimer) {
        clearInterval(gpsBlinkTimer);
        gpsBlinkTimer = null;
    }
    gpsBlinkOn = false;
}


function setGpsStatus(text) {
    const g = document.getElementById("screen-guidance");
    const s = document.getElementById("screen-start");
    const rt = state.runtime;

    // ★ 地下待機（上り・小竹向原行き・練馬到着後に立つ autoUndergroundReady）だけ点滅
    const isUndergroundWaiting =
        !rt.undergroundMode &&
        rt.autoUndergroundReady &&
        state.config.direction === "上り" &&
        state.config.dest === "小竹向原";

    // 点滅タイマー制御
    if (rt.undergroundMode) {
        stopGpsBlink();
    } else if (isUndergroundWaiting) {
        startGpsBlink();
    } else {
        stopGpsBlink();
    }

    // 速度表示テキスト（地下モード中は表示しない）
    const speedText =
        rt.lastPosition &&
        typeof rt.speedKmh === "number" &&
        Number.isFinite(rt.speedKmh)
            ? `${Math.round(rt.speedKmh)} km/h`
            : "— km/h";

    // ===== 地下モード中 =====
    if (rt.undergroundMode) {
        // 表示文言は「GPS」、色は黄色固定
        if (g && g._gpsStatus) {
            g._gpsStatus.textContent = "GPS";
            g._gpsStatus.style.color = "yellow";
        }
        if (s && s._gpsStatus) {
            s._gpsStatus.textContent = "GPS";
            s._gpsStatus.style.color = "yellow";
        }

        // ★ 速度表示は完全に消す
        if (g && g._gpsSpeed) {
            g._gpsSpeed.textContent = "";
            g._gpsSpeed.style.display = "none";
        }
        if (s && s._gpsSpeed) {
            s._gpsSpeed.textContent = "";
            s._gpsSpeed.style.display = "none";
        }
        return;
    }

    // ===== 地下モードではない =====
    // 速度欄は表示する（念のため display を戻す）
    if (g && g._gpsSpeed) {
        g._gpsSpeed.style.display = "";
        g._gpsSpeed.textContent = speedText;
    }
    if (s && s._gpsSpeed) {
        s._gpsSpeed.style.display = "";
        s._gpsSpeed.textContent = speedText;
    }

    // 地下待機中：文言/色は点滅側が管理（ここでは上書きしない）
    if (isUndergroundWaiting) {
        applyGpsBlinkColor(); // 初回反映の保険
        return;
    }

    // 通常表示（従来通り：text と GPS更新3秒で色分け）
    const displayText = text || "";

    const now = Date.now();
    const ageSec = rt.lastGpsUpdate ? (now - rt.lastGpsUpdate) / 1000 : 999;
    const color = ageSec <= 3 ? "lime" : "red";

    if (g && g._gpsStatus) {
        g._gpsStatus.textContent = displayText;
        g._gpsStatus.style.color = color;
    }
    if (g && g._gpsSpeed) {
        g._gpsSpeed.style.color = color;
    }

    if (s && s._gpsStatus) {
        s._gpsStatus.textContent = displayText;
        s._gpsStatus.style.color = color;
    }
    if (s && s._gpsSpeed) {
        s._gpsSpeed.style.color = color;
    }
}




// 汎用リスト（行先変更・種別変更）
function openList(title, list, onPick) {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");

	// サブ画面種別
	let kind = "list";
	if (title.includes("行先")) kind = "dest";
	else if (title.includes("種別")) kind = "type";

	// 既に同じ kind が開いていたらトグルで閉じる
	const existing = panel.querySelector(
		`.menu-subpanel[data-kind="${kind}"]`,
	);
	if (existing) {
		existing.remove();
		return;
	}

	// 他のサブ画面は閉じる
	panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

	const wrap = el(
		"div",
		{ class: "menu-subpanel", "data-kind": kind },
		[
			el("hr", { class: "sep" }),
			el("h3", {}, title),
			el(
				"div",
				{ class: "list" },
				list.map((v) => {
					const b = el("button", { class: "btn secondary" }, v);
					b.onclick = () => {
						onPick(v);
						modal.classList.remove("active");
					};
					return b;
				}),
			),
		],
	);

	panel.appendChild(wrap);
}

// 臨時停車・通過 ＋ 着発線変更（UI: A-1）
function openStopList() {
    const modal = document.getElementById("menuModal");
    const panel = modal.querySelector(".panel");

    const stations = state.datasets.stations;
    if (!stations) return;

    const kind = "stop";

    // 既に同じサブ画面が開いていればトグルで閉じる
    const existing = panel.querySelector(
        `.menu-subpanel[data-kind="${kind}"]`,
    );
    if (existing) {
        existing.remove();
        return;
    }

    // 他のサブ画面は閉じる
    panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

    const wrap = el(
        "div",
        { class: "menu-subpanel", "data-kind": kind },
        [
            el("hr", { class: "sep" }),
            el("h3", {}, "臨時停車・通過・着発線変更"),
        ],
    );

    const box = el("div", {
        style: "max-height:50vh;overflow:auto;font-size:14px;",
    });

    // 駅名の並び順は、これまでの「臨時停車・通過」と同じ
    const names = Object.keys(stations);

    // platform.json（あれば使用）
    const platforms = state.datasets.platforms || null;
    const dayType = state.config.dayType || "平日";
    const dayData = platforms && platforms[dayType] ? platforms[dayType] : null;

    const overrides = state.runtime.manualPlatforms || {};

    names.forEach((n) => {
        // ★ 現在の設定：passStations に入っていれば通過、入っていなければ停車
        const isCurrentlyPass = state.runtime.passStations.has(n);
        const isStopNow = !isCurrentlyPass;

        // 駅ごとのコンテナ
        const block = el("div", {
            class: "station-block",
            "data-station": n,
            style: "margin-bottom:6px;border-bottom:1px solid #ccc;padding-bottom:4px;",
        });

        // 1行構成（A-1）：チェックボックス + 駅名 + 番線ボタン群
        const row = el("div", {
            class: "row",
            style: "display:flex;align-items:center;flex-wrap:wrap;column-gap:4px;row-gap:2px;",
        });

        // --- 停車 / 通過 チェック ---
        const chk = el("input", { type: "checkbox" });
        chk.checked = isStopNow; // チェック = 停車扱い

        const label = el("label", {}, [chk, " ", n]);
        row.appendChild(label);

        // --- 番線ボタン群（platform.json にデータがある駅のみ） ---
        const stationPlatMap =
            dayData && dayData[n] ? dayData[n] : null;

        if (stationPlatMap) {
            const platNos = Object.keys(stationPlatMap).sort(
                (a, b) => parseInt(a, 10) - parseInt(b, 10),
            );

            if (platNos.length > 0) {
                const basePlat = getPlatformForStation(n); // この列車の標準番線（なければ null）
                const currentOverride = overrides[n] || null;

                // ★ 選択状態の初期値：
                //   1) 手動 override があればそれ
                //   2) なければ basePlat
                //   3) どちらも無ければ「何も選択しない」
                let selectedPlat = null;
                if (currentOverride) {
                    selectedPlat = currentOverride;
                } else if (basePlat) {
                    selectedPlat = basePlat;
                }

                platNos.forEach((platNo) => {
                    const btn = el(
                        "button",
                        {
                            class:
                                "btn secondary" +
                                (selectedPlat &&
                                String(platNo) === String(selectedPlat)
                                    ? " active-selected"
                                    : ""),
                            type: "button",
                            "data-plat": platNo,
                            // ボタンサイズに対して 1/2 くらいの間隔イメージ
                            style: "margin-left:4px;padding:2px 6px;",
                        },
                        `${platNo}番`,
                    );

                    btn.onclick = (e) => {
                        // 同じ駅内の他番線ボタンの active を外し、このボタンだけ active に
                        const parent = e.currentTarget.parentElement;
                        parent
                            .querySelectorAll("button[data-plat]")
                            .forEach((b) =>
                                b.classList.remove("active-selected"),
                            );
                        e.currentTarget.classList.add("active-selected");
                    };

                    row.appendChild(btn);
                });
            }
        }

        block.appendChild(row);
        box.appendChild(block);
    });

    const done = el("button", { class: "btn", style: "margin-top:8px;" }, "決定");
    done.onclick = () => {
        const newStopSet = new Set();
        const newOverrides = {};

        const blocks = box.querySelectorAll(".station-block");

        blocks.forEach((block) => {
            const stationName = block.getAttribute("data-station");
            if (!stationName) return;

            // 停車／通過の反映
            const chk = block.querySelector('input[type="checkbox"]');
            if (chk && chk.checked) {
                newStopSet.add(stationName); // チェック = 停車駅
            }

            // 番線の反映
            const activePlatBtn = block.querySelector(
                "button[data-plat].active-selected",
            );

            const basePlat = getPlatformForStation(stationName);
            const selectedPlat =
                activePlatBtn && activePlatBtn.getAttribute("data-plat")
                    ? activePlatBtn.getAttribute("data-plat")
                    : null;

            // ★ 標準番線と異なる場合のみ「着発線変更」として保存
            if (selectedPlat) {
                if (!basePlat || String(selectedPlat) !== String(basePlat)) {
                    newOverrides[stationName] = selectedPlat;
                }
            }
        });

        // 通過駅 = 全駅 - 停車駅
        state.runtime.passStations = new Set(
            names.filter((n) => !newStopSet.has(n)),
        );

        // 着発線変更の反映
        state.runtime.manualPlatforms = newOverrides;

        modal.classList.remove("active");
    };

    wrap.append(box, done);
    panel.appendChild(wrap);
}

// 音量設定・テスト
function openVolumePanel() {
    const modal = document.getElementById("menuModal");
    const panel = modal.querySelector(".panel");
    const kind = "volume";

    // 既に同じサブ画面が開いていればトグルで閉じる
    const existing = panel.querySelector(
        `.menu-subpanel[data-kind="${kind}"]`,
    );
    if (existing) {
        existing.remove();
        return;
    }

    // 他のサブ画面は閉じる
    panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

    // ★ 現在の音量（0〜100%）
    const currentVol = Math.round(
        (typeof state.config.voiceVolume === "number"
            ? state.config.voiceVolume
            : 1.0) * 100,
    );

	const slider = el("input", {
		type: "range",
		min: "0",
		max: "100",
		value: String(currentVol),
		step: "5",               // ★ 0〜100 を 5% 刻み＝20段階
		style: "width:100%;",
	});

    const label = el("span", {}, `${currentVol}%`);

    slider.oninput = () => {
        const v = Number(slider.value);
        label.textContent = `${v}%`;
        // 0〜1 に変換して保存
        state.config.voiceVolume = Math.min(Math.max(v / 100, 0), 1);
    };

    const testBtn = el("button", { class: "btn" }, "テスト音声を再生");
    testBtn.onclick = () => {
        // ★ テストは毎回鳴らしたいのでキーをユニークにする
        const key = "test_volume_" + Date.now();
        speakOnce(key, "これは音量テストです。");
    };

    const wrap = el(
        "div",
        { class: "menu-subpanel", "data-kind": kind },
        [
            el("hr", { class: "sep" }),
            el("h3", {}, "音量設定"),
            el("div", { class: "row" }, [
                el("label", {}, "音量"),
            ]),
            el("div", { class: "row" }, [
                slider,
            ]),
            el("div", { class: "row" }, [
                el("span", {}, "現在: "),
                label,
            ]),
            el("div", { class: "row", style: "margin-top:8px;" }, [
                testBtn,
            ]),
        ],
    );

    panel.appendChild(wrap);
}

// ★ 運行情報キャッシュ
let operationInfoCache = {
    lastFetched: 0,
    text: "",
};

// ★ 運行情報パネル
function openOperationInfo() {
    const modal = document.getElementById("menuModal");
    const panel = modal.querySelector(".panel");
    const kind = "info";

    // 既に同じサブ画面が開いていればトグルで閉じる
    const existing = panel.querySelector(
        `.menu-subpanel[data-kind="${kind}"]`,
    );
    if (existing) {
        existing.remove();
        return;
    }

    // 他のサブ画面は閉じる
    panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

    const body = el("div", { class: "row", id: "operationInfoBody" }, "取得中…");

    const wrap = el(
        "div",
        { class: "menu-subpanel", "data-kind": kind },
        [
            el("hr", { class: "sep" }),
            el("h3", {}, "運行情報"),
            body,
        ],
    );

    panel.appendChild(wrap);

    const now = Date.now();
    // ★ 2分以内ならキャッシュを使用
    if (
        operationInfoCache.text &&
        now - operationInfoCache.lastFetched < 120000
    ) {
        body.textContent = operationInfoCache.text + "（※2分以内の再取得は行っていません）";
        return;
    }

    // ★ API から取得
    fetch("https://train.seibuapp.jp/trainfo-api/ti/v1.0/lines/all/status")
        .then((r) => r.json())
        .then((data) => {
            let text = "情報を取得できませんでした。";
            try {
                if (data && data.lineStatus && data.lineStatus.length > 0) {
                    text = data.lineStatus[0].operationDetail || text;
                }
            } catch (e) {
                // 解析失敗時はそのまま
            }
            operationInfoCache.lastFetched = Date.now();
            operationInfoCache.text = text;
            body.textContent = text;
        })
        .catch(() => {
            body.textContent = "運行情報の取得に失敗しました。";
        });
}

// 着発線変更
function openPlatformList() {
    const modal = document.getElementById("menuModal");
    const panel = modal.querySelector(".panel");
    const kind = "platform";

    // 既に同じサブ画面が開いていればトグルで閉じる
    const existing = panel.querySelector(
        `.menu-subpanel[data-kind="${kind}"]`,
    );
    if (existing) {
        existing.remove();
        return;
    }

    // 他のサブ画面は閉じる
    panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

    const wrap = el(
        "div",
        { class: "menu-subpanel", "data-kind": kind },
        [
            el("hr", { class: "sep" }),
            el("h3", {}, "着発線変更"),
        ],
    );

    const platforms = state.datasets.platforms;
    if (!platforms) {
        wrap.append(
            el("div", { class: "row" }, "platform.json が読み込まれていません。"),
        );
        panel.appendChild(wrap);
        return;
    }

    const dayType = state.config.dayType || "平日";
    const dayData = platforms[dayType];
    if (!dayData) {
        wrap.append(
            el(
                "div",
                { class: "row" },
                `「${dayType}」の番線データが見つかりません。`,
            ),
        );
        panel.appendChild(wrap);
        return;
    }

    const box = el("div", {
        style: "max-height:50vh;overflow:auto;font-size:14px;",
    });

    // 駅名一覧（空文字は除外）
    const stationNames = Object.keys(dayData)
        .filter((n) => n && n.trim())
        .sort((a, b) => a.localeCompare(b, "ja"));

    const overrides = state.runtime.manualPlatforms || {};

    stationNames.forEach((stationName) => {
        const platMap = dayData[stationName];
        if (!platMap) return;

        const platNos = Object.keys(platMap).sort(
            (a, b) => parseInt(a, 10) - parseInt(b, 10),
        );
        if (platNos.length === 0) return;

        // 標準の番線（platform.json による現在列車の想定番線）
        const basePlat = getPlatformForStation(stationName);
        const currentOverride = overrides[stationName] || null;
        const selectedPlat = currentOverride || basePlat || platNos[0];

        const row = el(
            "div",
            {
                class: "row plat-row",
                "data-station": stationName,
                style: "margin-bottom:4px;",
            },
            [],
        );

        // 駅名
        row.appendChild(
            el(
                "span",
                {
                    style:
                        "display:inline-block;min-width:6em;margin-right:4px;",
                },
                stationName,
            ),
        );

        // 各番線のラジオボタン（見た目はチェックに近いが 1つだけ選択）
        platNos.forEach((platNo) => {
            const id = `plat_${stationName}_${platNo}`;

            const input = el("input", {
                type: "radio",
                name: `plat_${stationName}`,
                value: platNo,
                id,
            });
            if (String(platNo) === String(selectedPlat)) {
                input.checked = true;
            }

            const label = el(
                "label",
                {
                    for: id,
                    style: "margin-right:8px;",
                },
                `${platNo}番`,
            );

            row.appendChild(input);
            row.appendChild(label);
        });

        box.appendChild(row);
    });

    const done = el("button", { class: "btn", style: "margin-top:8px;" }, "決定");
    done.onclick = () => {
        const newOverrides = {};
        const rows = box.querySelectorAll(".plat-row");

        rows.forEach((row) => {
            const stationName = row.getAttribute("data-station");
            const basePlat = getPlatformForStation(stationName);
            const checked = row.querySelector('input[type="radio"]:checked');
            if (!checked) return;

            const selectedPlat = checked.value;

            // 標準番線と同じなら「変更なし」扱いで override は保存しない
            if (basePlat && String(basePlat) === String(selectedPlat)) {
                return;
            }

            // 標準番線と異なる場合だけ「着発線変更」として保存
            newOverrides[stationName] = selectedPlat;
        });

        state.runtime.manualPlatforms = newOverrides;
        modal.classList.remove("active");
    };

    wrap.append(box, done);
    panel.appendChild(wrap);
}

// 列番変更
function openTrainChange() {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");
	const names = Object.keys(state.datasets.stations);

	const kind = "train";

	// 既に同じサブ画面が開いていればトグルで閉じる
	const existing = panel.querySelector(
		`.menu-subpanel[data-kind="${kind}"]`,
	);
	if (existing) {
		existing.remove();
		return;
	}

	// 他のサブ画面は閉じる
	panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

	const wrap = el(
		"div",
		{ class: "menu-subpanel", "data-kind": kind },
		[
			el("hr", { class: "sep" }),
			el("h3", {}, "列番変更"),
		],
	);

	const sel = el("select");
	names.forEach((n) => {
		sel.appendChild(el("option", { value: n }, n));
	});
	const input = el("input", { type: "text", placeholder: "例：1234" });
	const done = el("button", { class: "btn" }, "決定");
	done.onclick = () => {
		state.runtime.manualTrainChangeAt = sel.value;
		state.runtime.manualTrainNo = input.value.trim();
		modal.classList.remove("active");
	};

	wrap.append(sel, input, done);
	panel.appendChild(wrap);
}

// ==== 停車パターン（ダイヤ上の基本停車駅） ====

function baseIsStop(stationName) {
    // まずダイヤ上の停車かどうか
    let base = baseIsStopRaw(stationName);

    // 回送・試運転・臨時など非客扱い列車で、
    // 追加画面で選ばれた駅は「通常停車扱い」にする
    if (isNonPassenger(state.config.type)) {
        const extra = state.runtime.nonPassengerExtraStops;
        if (extra && extra.has(stationName)) {
            base = true;
        }
    }
    return base;
}

// ==== 停車パターン（ダイヤ上の基本停車駅） ====

function baseIsStopRawForType(stationName, type) {
    const info = state.datasets.stations[stationName];
    if (!info || !info.stopPatterns) return true; // 情報がなければ停車扱いにしておく

    const sp = info.stopPatterns;

    const tt = normalizeTypeName(type);
    if (!tt) return true; // 種別が未指定なら安全側で停車扱い

    return !!sp[tt];
}

// 既存の baseIsStopRaw は、現在の state.config.type を使う薄いラッパーに変更
function baseIsStopRaw(stationName) {
    return baseIsStopRawForType(stationName, state.config.type);
}

function baseIsStop(stationName) {
    // まずダイヤ上の停車かどうか（現在の種別で判定）
    let base = baseIsStopRaw(stationName);

    // 回送・試運転・臨時など非客扱い列車で、
    // 追加画面で選ばれた駅は「通常停車扱い」にする
    if (isNonPassenger(state.config.type)) {
        const extra = state.runtime.nonPassengerExtraStops;
        if (extra && extra.has(stationName)) {
            base = true;
        }
    }
    return base;
}

function baseIsStopRaw(stationName) {
    const info = state.datasets.stations[stationName];
    if (!info || !info.stopPatterns) return true; // 情報がなければ停車扱いにしておく
    const sp = info.stopPatterns;
    return !!sp[state.config.type]; // 例: "快速急行" など
}

// ==== 停車駅/通過駅リスト生成（ダイヤ基準） ====
function buildPassStationList() {
	const stations = state.datasets.stations;
	const pass = [];

	for (const [name] of Object.entries(stations)) {
		const baseStop = baseIsStop(name); // ダイヤ上の停車かどうか

		// baseStop が false = ダイヤ上は通過駅
		if (!baseStop) {
			pass.push(name);
		}
	}

	state.runtime.passStations = new Set(pass);
}

// ==== 路線ごとの駅順（物理順） ====

// 池袋線（本線）
const MAIN_LINE_ORDER = [
	"池袋",
	"椎名町",
	"東長崎",
	"江古田",
	"桜台",
	"練馬",
	"中村橋",
	"富士見台",
	"練馬高野台",
	"石神井公園",
	"大泉学園",
	"保谷",
	"ひばりヶ丘",
	"東久留米",
	"清瀬",
	"秋津",
	"所沢",
	"西所沢",
	"小手指",
	"狭山ヶ丘",
	"武蔵藤沢",
	"稲荷山公園",
	"入間市",
	"仏子",
	"元加治",
	"飯能",
	"東飯能",
	"武蔵丘",
	"高麗",
	"武蔵横手",
	"東吾野",
	"吾野",
	"西吾野",
	"正丸",
	"正丸トンネル",
	"芦ヶ久保",
	"横瀬",
	"西武秩父",
];

// 有楽町線
const YURAKU_LINE_ORDER = [
	"小竹向原",
	"新桜台",
	"練馬",
];

// 豊島線
const TOSHIMA_LINE_ORDER = [
	"練馬",
	"豊島園",
];

// 狭山線
const SAYAMA_LINE_ORDER = [
	"西所沢",
	"下山口",
	"西武球場前",
];

// ==== 行先カテゴリ判定 ====

// 有楽町線へ進む行先
const DEST_YURAKU = ["小竹向原"];

// 豊島線へ進む行先
const DEST_TOSHIMA = ["豊島園"];

// 狭山線へ進む行先
const DEST_SAYAMA = ["西武球場前", "下山口"];

// 新宿線直通として扱う行先（所沢より先は案内しない）
const DEST_SHINJUKU = ["新宿線直通"];

// 本線として扱う行先（ご提示いただいた一覧）
const DEST_MAIN = [
	"池袋",
	"東長崎",
	"練馬",
	"練馬高野台",
	"石神井公園",
	"保谷",
	"ひばりヶ丘",
	"清瀬",
	"所沢",
	"西所沢",
	"小手指",
	"狭山ヶ丘",
	"入間市",
	"仏子",
	"飯能",
	"武蔵丘",
	"高麗",
	"武蔵横手",
	"東吾野",
	"吾野",
	"西吾野",
	"正丸",
	"正丸トンネル",
	"芦ヶ久保",
	"横瀬",
	"西武秩父",
];

// 行先がどのカテゴリかざっくり判定（必要に応じて利用）
function getDestCategory(dest) {
	if (DEST_YURAKU.includes(dest)) return "yuraku";
	if (DEST_TOSHIMA.includes(dest)) return "toshima";
	if (DEST_SAYAMA.includes(dest)) return "sayama";
	if (DEST_SHINJUKU.includes(dest)) return "shinjuku";
	if (DEST_MAIN.includes(dest)) return "main";
	return "main"; // 不明な場合は本線扱い
}



// ある駅名がどの路線配列に属しているかを返す
function getLineForStation(name) {
    // ★ まず、すでにルートが確定している場合はその路線を優先する
    const rt = state.runtime.routeLine;

    if (rt === "main"   && MAIN_LINE_ORDER.includes(name))   return "main";
    if (rt === "yuraku" && YURAKU_LINE_ORDER.includes(name)) return "yuraku";
    if (rt === "toshima"&& TOSHIMA_LINE_ORDER.includes(name))return "toshima";
    if (rt === "sayama" && SAYAMA_LINE_ORDER.includes(name)) return "sayama";

    // ★ ルート未確定 or 上の条件に当てはまらない駅は従来どおり
    if (MAIN_LINE_ORDER.includes(name))   return "main";
    if (YURAKU_LINE_ORDER.includes(name)) return "yuraku";
    if (TOSHIMA_LINE_ORDER.includes(name))return "toshima";
    if (SAYAMA_LINE_ORDER.includes(name)) return "sayama";

    return null;
}

// ある駅が、lockedLine（main / toshima / sayama / yuraku）に属してよいかどうか
function stationBelongsToLockedLine(name, lockedLine) {
    if (!lockedLine) return true; // ルート未確定なら全駅候補

    // 池袋線本線
    if (lockedLine === "main") {
        // 本線上の駅はもちろんOK
        if (MAIN_LINE_ORDER.includes(name)) return true;

        // 練馬は豊島線・有楽町線との共通駅として、mainでも拾いたい
        if (name === "練馬") return true;

        // 西所沢も狭山線との共通駅として拾っておく
        if (name === "西所沢") return true;

        return false;
    }

    // 豊島線ロック時：豊島線＋練馬（共通駅）を許可
    if (lockedLine === "toshima") {
        if (TOSHIMA_LINE_ORDER.includes(name)) return true;
        if (name === "練馬") return true;  // ← ココが今回の肝
        return false;
    }

    // 狭山線ロック時：狭山線＋西所沢（共通駅）を許可
    if (lockedLine === "sayama") {
        if (SAYAMA_LINE_ORDER.includes(name)) return true;
        if (name === "西所沢") return true;
        return false;
    }

    // 有楽町線ロック時：有楽町線＋小竹向原＋練馬（共通駅）を許可
    if (lockedLine === "yuraku") {
        if (YURAKU_LINE_ORDER.includes(name)) return true;
        if (name === "小竹向原" || name === "練馬") return true;
        return false;
    }

    // 想定外の値はとりあえず制限しない
    return true;
}


// ★ 駅名から stationId を引く（stationID.json を全走査）
//    → 駅名は「完全一致」のみで検索する
function getStationIdByName(name) {
    const data = state.datasets.stationIds;
    if (!data || !name) return null;

    const key = name.trim();

    for (const groupStations of Object.values(data)) {
        if (!Array.isArray(groupStations)) continue;
        for (const s of groupStations) {
            if (!s.stationName) continue;

            const cand = s.stationName.trim();

            // ★ 完全一致のみ
            if (cand === key) {
                return s.stationId;
            }
        }
    }
    return null;
}

// ★ 遅延情報取得用：現在の列車が関係しそうな lineId を返す
function getCurrentLineIdsForDelay() {
    const ids = new Set();
    const route   = state.runtime.routeLine;           // "main" / "yuraku" / "toshima" / "sayama" / null
    const destCat = getDestCategory(state.config.dest);
    const dest    = state.config.dest;

    // ★ 狭山線内のみの列車（西所沢↔西武球場前・下山口）は
    //   常に狭山線ID（L002）のみを参照する
    const isSayamaOnly =
        route === "sayama" &&
        (dest === "西所沢" || dest === "西武球場前" || dest === "下山口");
    
    if (isSayamaOnly) {
        ids.add("L002");        // 狭山線
        return Array.from(ids);
    }

    // --- ルート確定済みの場合 ---
    if (route === "main") {
        ids.add("L001");        // 池袋線
    } else if (route === "toshima") {
        ids.add("L003");        // 豊島線
    } else if (route === "sayama") {
        ids.add("L002");        // 狭山線
    } else if (route === "yuraku") {
        ids.add("L005");        // 有楽町線
    } else {
        // --- ルート未確定の場合（行先から推定） ---
        if (destCat === "toshima") {
            ids.add("L001");    // 池袋線区間
            ids.add("L003");    // 豊島線
        } else if (destCat === "sayama") {
            ids.add("L001");    // 池袋線区間
            ids.add("L002");    // 狭山線
        } else if (destCat === "yuraku") {
            ids.add("L001");    // 池袋線区間
            ids.add("L005");    // 有楽町線
        } else {
            ids.add("L001");    // それ以外は池袋線だけ
        }
    }

    return Array.from(ids);
}

// ★ 遅延検索用：現在案内中の列車番号を取得
//   （必要に応じて manualTrainNo を使いたい場合はここにロジックを追加）
function getCurrentTrainNoForDelay() {
    return String(state.config.trainNo || "").trim();
}

// ★ 出発時刻フィールドを色々な揺れに対応して取り出す
function extractDepartureHms(detail) {
    if (!detail) return null;

    // 1) まずは今回あなたが指定している "departureHms"
    let raw =
        detail.departureHms ||
        detail.departureTime ||        // 英語名その1
        detail["出発時間"] ||          // 日本語キー
        detail["出発Hms"] ||          // 例に出てきたブレたキー
        null;

    if (!raw) return null;

    // 数字以外を全部削る & 6桁になるようにゼロ埋め
    raw = String(raw).replace(/\D/g, "").padStart(6, "0");

    const hh = raw.slice(0, 2);
    const mm = raw.slice(2, 4);
    const ss = raw.slice(4, 6);

    return `${hh}:${mm}:${ss}`; // "12:14:00" の形式に整形
}


// ★ 次の停車駅の発車時刻を取得して表示
async function fetchAndShowNextDeparture(nextStationName) {
    const root = document.getElementById("screen-guidance");
    if (!root || !root._nextDepart) return;

    const el = root._nextDepart;

    // いったん消してから更新
    el.textContent = "";
    el.style.visibility = "hidden";

    // --- 駅ID 取得 ---
    const stationId = getStationIdByName(nextStationName);
    if (!stationId) {
        // stationID.json に無い駅 → 何も表示しない
        return;
    }

    // --- 列車番号 取得 ---
    const trainNo = getCurrentTrainNoForDelay();
    if (!trainNo) {
        return;
    }

    const dirApi = state.config.direction === "上り" ? "up" : "down";

    try {
        const url = `https://train.seibuapp.jp/trainfo-api/ti/v1.0/stations/${stationId}/departures`;
        const res = await fetch(url);

        if (!res.ok) {
            // HTTP エラー時も何も表示しない
            return;
        }

        const data = await res.json();

        // APIのキー揺れ対策：'departure' or '出発'
        const depList =
            data.departure ||
            data.departures ||
            data["出発"] ||
            [];

        let found = null;

        for (const dep of depList) {
            // ★ iPad 対応のため、ここでは lineId で絞り込まない

            const details =
                dep.detail ||
                dep.details ||
                dep["detail"] ||
                [];

            for (const d of details) {
                const dTrainNo = String(
                    d.trainNo ||
                    d["trainNo"] ||
                    d["列車番号"] ||
                    "",
                ).trim();

                if (dTrainNo !== trainNo) continue;

                const dDir =
                    d.direction ||
                    d["direction"] ||
                    d["方向"] ||
                    null;

                // direction が取れる場合だけ照合
                if (dDir && dDir !== dirApi) continue;

                found = d;
                break;
            }
            if (found) break;
        }

        if (!found) {
            // 該当列車が無い場合も特に何も出さない
            return;
        }

        // ★ 時刻フィールドの揺れをまとめて処理
        const hms = extractDepartureHms(found);
        if (!hms) {
            return;
        }

        // 例：「池袋　12:34:00　発」
        el.textContent = `${nextStationName}　${hms}　発`;
        el.style.visibility = "visible";

    } catch (e) {
        // 通信エラー時も、状態表示は行わない（何も出さない）
        return;
    }
}

// ==== 地下モード ヘルパー ====

// 地下モード開始（方向に応じて初期処理を分ける）
function enterUndergroundMode(source) {
    const rt = state.runtime;
    rt.undergroundMode = true;
    rt.undergroundSource = source || null;
    rt.undergroundLastToStationName = null;

    // 有楽町線として固定
    rt.routeLine = "yuraku";
    rt.routeLocked = true;

    // 表示欄は「地下モード」
    setGpsStatus("地下モード");

    // 方向別の初期発車時刻取得
    if (state.config.direction === "下り") {
        // 小竹向原 発時刻
        fetchAndShowNextDeparture("小竹向原");
    } else if (state.config.direction === "上り") {
        // 新桜台 発時刻（通過や情報なしなら何も表示されない）
        fetchAndShowNextDeparture("新桜台");
    }

    // ★ 地下モード中は駅間表示しない
    clearSegmentDisplay();
}

// 地下モード終了（newRouteLine には "main" などを指定）
// ★ opts.forceStationName が指定されたら「その駅にいるものとして」地点リセット相当を確定実行する
function exitUndergroundMode(newRouteLine, opts) {
    const rt = state.runtime;
    if (!rt.undergroundMode) return;

    opts = opts || {};

    rt.undergroundMode = false;
    rt.undergroundSource = null;
    rt.undergroundLastToStationName = null;

    if (newRouteLine) {
        rt.routeLine = newRouteLine;      // 例: "main"
        rt.routeLocked = true;
    } else {
        // ルート再推定を許可する場合
        rt.routeLine = null;
        rt.routeLocked = false;
    }

    // 表示欄をいったんクリア（次の GPS 更新で上書きされる）
    setGpsStatus("");

    // ★ 次のGPS更新で再描画されるが、一旦クリアしておく
    clearSegmentDisplay();

    // ★ ここから追加：地下解除時は「地点リセット」と同様の処理を行う
    //   案内中のみ実施（started=false のときは触らない）
    if (rt.started) {
        startStartupLocationDetection();

        // ★ 練馬接近など「特定駅にいるものとして」確定させたい場合
        if (opts.forceStationName) {
            initStartupAtStation(opts.forceStationName);

            // 起動判定を確定終了させる（次の onPos で再判定されないように）
            rt.startupMode = false;
            rt.startupFixed = true;
        }
    }
}


// trains?lineId= の toStationName を使った地下モード処理
function handleUndergroundToStationName(toName) {
    if (!state.runtime.undergroundMode) return;
    if (!toName) return;

    const rt = state.runtime;
    const prev = rt.undergroundLastToStationName;
    rt.undergroundLastToStationName = toName;

    const dir = state.config.direction;

    // ---- 下り列車の地下モード ----
    if (dir === "下り") {
        // toStationName が変化したときだけ、その駅の発車時刻を再取得
        if (toName !== prev) {
            // 情報が null の場合（toName なし）はここに来ないので、前の表示を維持
            fetchAndShowNextDeparture(toName);
        }

        // ★ 変更点：API(toStationName) による自動解除は削除
        // if (toName === "練馬") {
        //     exitUndergroundMode("main");
        // }

        return;
    }

    // ---- 上り列車の地下モード ----
    if (dir === "上り") {
        // 小竹向原 到着が見えたら、もう一度「搭載かばん、確認」
        if (toName === "小竹向原" && toName !== prev) {
            speakOnce("ug_arr_kaban", "搭載かばん、確認");

            // ★ 追加：上り SトレA / 上り SトレB は続けて「運転停車、ドア扱い注意」
            if (
                (state.config.type === "SトレA" || /^SトレB/.test(String(state.config.type || ""))) &&
                state.config.direction === "上り"
            ) {
                speakOnce("ug_strain_opstop", "運転停車、ドア扱い注意");
            }
        }
        return;
    }
}




// ==== 発着番線取得 ====
// platform.json: dayType ("平日" / "土休日") → 駅名 → 番線番号 → [列車番号...]
function getPlatformForStation(stationName) {
    const platforms = state.datasets.platforms;
    if (!platforms) return null;

    const dayType = state.config.dayType || "平日";
    const dayData = platforms[dayType];
    if (!dayData) return null;

    const stationData = dayData[stationName];
    if (!stationData) return null;

    const n = parseInt(state.config.trainNo, 10);
    if (Number.isNaN(n)) return null;

    // 各番線の配列を見て、自列車番号が含まれている番線を探す
    for (const [platNo, list] of Object.entries(stationData)) {
        if (!Array.isArray(list)) continue;
        if (list.includes(n)) {
            return platNo; // 文字列の "1" "2" ... をそのまま返す
        }
    }
    return null;
}

// ==== 発着番線（実際に使う値） ====
// 手動変更があればそれを優先し、なければ platform.json の標準値を使う
function getEffectivePlatformForStation(stationName) {
    const overrides = state.runtime.manualPlatforms || {};
    if (overrides[stationName]) {
        return overrides[stationName];   // 例: "1" "2" など
    }
    return getPlatformForStation(stationName);
}

// ==== 番線が「着発線変更」されているかどうか ====
// ・手動値が存在し、かつ標準値と異なっていれば true
function isPlatformChanged(stationName) {
    const overrides = state.runtime.manualPlatforms || {};
    const override = overrides[stationName];
    if (!override) return false;

    const base = getPlatformForStation(stationName);
    if (!base) return true; // 標準設定が無いのに手動があるケース

    return String(override) !== String(base);
}


// 1 本の路線配列の中で、direction（上り/下り）と passStations を考慮して
// 「次に実際に停車する駅」を探す共通ヘルパー
function findNextOnLine(line, fromName, direction) {
	const idx = line.indexOf(fromName);
	if (idx === -1) return null;

	const step = direction === "下り" ? 1 : -1;

	// 「新宿線直通」行先のときは、所沢より上り方向（池袋側）は案内しない
	const isShinjukuThrough = DEST_SHINJUKU.includes(state.config.dest);
	const tokorozawaIndex = line.indexOf("所沢");

	for (let i = idx + step; i >= 0 && i < line.length; i += step) {
		const n = line[i];

		// 新宿線直通：上り方向で所沢より先（池袋側）は案内不要
		if (isShinjukuThrough && direction === "上り" && tokorozawaIndex !== -1) {
			// 上り = インデックスが小さくなる方向に進む
			if (i < tokorozawaIndex) {
				// 所沢よりさらに池袋側なので、ここから先は案内しない
				return null;
			}
		}

		// 実際に停車する駅だけ対象（passStations に入っていない＝停車駅）
		if (!state.runtime.passStations.has(n)) {
			return n;
		}
	}
	return null;
}

// ==== 次に停車する駅名を取得 ====
// ・fromName = いま停車している（または直前に停車していた）駅
// ・state.config.direction = "上り" / "下り"
// ・state.config.dest = 行先
// をもとに、本線／支線の分岐を考慮して次の停車駅を返す
function findNextStopStationName(fromName) {
	const dir = state.config.direction;   // "上り" or "下り"
	const dest = state.config.dest;

	const destCat = getDestCategory(dest);
	const lineOfFrom = getLineForStation(fromName);

	// 安全側：どの路線にも属さない駅名ならあきらめる
	if (!lineOfFrom) return null;

	// --- 分岐駅の特別処理 ---

	// 練馬での分岐
	if (fromName === "練馬") {
		if (dir === "上り" && destCat === "yuraku") {
			// 有楽町線：練馬から上り方向に分岐 → 有楽町線（練馬→新桜台→小竹向原）
			return findNextOnLine(YURAKU_LINE_ORDER, fromName, "上り");
		}
		if (dir === "下り" && destCat === "toshima") {
			// 豊島線：練馬から下り方向に分岐 → 豊島線（練馬→豊島園）
			return findNextOnLine(TOSHIMA_LINE_ORDER, fromName, "下り");
		}
		// それ以外の行先は本線継続扱い
		return findNextOnLine(MAIN_LINE_ORDER, fromName, dir);
	}

	// 西所沢での分岐
	if (fromName === "西所沢") {
		if (dir === "下り" && destCat === "sayama") {
			// 狭山線：西所沢から下り方向に分岐 → 狭山線（西所沢→下山口→西武球場前）
			return findNextOnLine(SAYAMA_LINE_ORDER, fromName, "下り");
		}
		// それ以外は本線（池袋線）扱い
		return findNextOnLine(MAIN_LINE_ORDER, fromName, dir);
	}

	// 所沢より先は案内不要（新宿線直通・上り）
	// → ただし「所沢行き」までの手前駅からは普通に「次は所沢…」と案内される
	if (DEST_SHINJUKU.includes(dest) && fromName === "所沢" && dir === "上り") {
		return null;
	}

	// --- 通常の処理 ---
	// 現在所属している路線ごとに、対応する配列＆向きで次停車駅を検索

	if (lineOfFrom === "main") {
		return findNextOnLine(MAIN_LINE_ORDER, fromName, dir);
	}
	if (lineOfFrom === "yuraku") {
		return findNextOnLine(YURAKU_LINE_ORDER, fromName, dir);
	}
	if (lineOfFrom === "toshima") {
		return findNextOnLine(TOSHIMA_LINE_ORDER, fromName, dir);
	}
	if (lineOfFrom === "sayama") {
		return findNextOnLine(SAYAMA_LINE_ORDER, fromName, dir);
	}

	// 想定外（ここには基本来ない）
	return null;
}

// ==== ルート確定ロジック（池袋線 / 狭山線 / 有楽町線 / 豊島線） ====
// ns: nearestStation() の結果オブジェクト { name, distance, ... }
function updateRouteLock(ns) {
    if (!ns) return;

    const dir  = state.config.direction;  // "上り" / "下り"
    const dest = state.config.dest;       // 行先（例: "小竹向原", "豊島園", "西武球場前" など）

    // これまでの判定結果
    let newRoute = state.runtime.routeLine || null;

    // --- ① 狭山線（西武球場前 / 西所沢 周辺） --------------------------

    if (ns.name === "西武球場前") {
        newRoute = "sayama";
    }

    if (ns.name === "西所沢" && ns.distance <= 200) {
        if (dir === "下り") {
            if (dest === "下山口" || dest === "西武球場前") {
                newRoute = "sayama";
            } else {
                newRoute = "main";
            }
        } else if (dir === "上り") {
            if (dest === "西所沢") {
                newRoute = "sayama";
            } else {
                newRoute = "main";
            }
        }
    }

    // --- ② 有楽町線・豊島線・池袋線（練馬・小竹向原・豊島園 周辺） ----

    if (ns.name === "小竹向原") {
        if (dir === "下り") {
            newRoute = "yuraku";
        }
    }

    // ★ 修正：豊島園での判定は「200m圏内」のときだけ行う
    // （上り豊島園＝練馬方面に向かう列車）
    if (ns.name === "豊島園" && dir === "上り" && ns.distance <= 200) {
        newRoute = "toshima";
    }

    if (ns.name === "練馬" && ns.distance <= 200) {
        if (dir === "上り") {
            if (dest === "小竹向原") {
                newRoute = "yuraku";
            } else {
                newRoute = "main";
            }
        } else if (dir === "下り") {
            if (dest === "豊島園") {
                newRoute = "toshima";
            } else {
                newRoute = "main";
            }
        }
    }

    // 東長崎 200m 以内 & 下り → 池袋線 確定（有楽町線分岐より先）
    if (ns.name === "東長崎" && dir === "下り" && ns.distance <= 200) {
        newRoute = "main";
    }

    // ★ 追加：上り列車が富士見台 200m 圏内に進入したら池袋線に確定
    if (ns.name === "富士見台" && dir === "上り" && ns.distance <= 200) {
        newRoute = "main";
    }

    // ★ 追加：小手指 200m 圏内に進入したら池袋線に確定（方向問わず main でOK）
    if (ns.name === "小手指" && ns.distance <= 200) {
        newRoute = "main";
    }

    // --- ③ 判定結果の反映 ---------------------------------------------

    if (newRoute && newRoute !== state.runtime.routeLine) {
        state.runtime.routeLine  = newRoute;
        state.runtime.routeLocked = true;
    }
}



// ★ 画面消灯防止用 Wake Lock
let wakeLock = null;

async function requestWakeLock() {
	if (!("wakeLock" in navigator)) return;
	try {
		wakeLock = await navigator.wakeLock.request("screen");
	} catch (e) {
		console.warn("wakeLock request failed:", e);
	}
}

function releaseWakeLock() {
	if (!wakeLock) return;
	wakeLock
		.release()
		.catch(() => {})
		.finally(() => {
			wakeLock = null;
		});
}

// ★ フォアグラウンド復帰時に、案内中なら再度 Wake Lock を取得
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible" && state.runtime.started) {
		requestWakeLock();
	}
});

let clockTimer = null;
let delayTimer = null;   // ★ 遅延更新用
// ★ watchPosition 用
let gpsWatchId = null;

// ★ 速度の履歴（移動平均＋外れ値対策用）
const gpsSpeedHistory = [];
const GPS_SPEED_HISTORY_SIZE = 5;

// ★ GPS 監視を行う共通関数（開始画面・案内画面共通）
//    watchPosition でブラウザに継続追跡させる
function startGpsWatch() {
    if (gpsWatchId) return;  // すでに開始済みなら何もしない

    if (!navigator.geolocation) {
        alert("GPS使用不可");
        setGpsStatus("GPSが利用できません");
        return;
    }

    gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            // ★ ① 精度チェック（accuracyが大きすぎるものは破棄）
            const acc = pos.coords.accuracy ?? 9999;
            if (acc > 200) {
                setGpsStatus(`位置情報の精度が低いため無視しました（約${acc.toFixed(0)}m）`);
                return;
            }

            // ★ ② 取得時刻が古すぎるデータも捨てる（念のため）
            const now = Date.now();
            const gpsTime = pos.timestamp;
            const ageMs = now - gpsTime;
            if (ageMs > 10000) {  // 10秒以上前のデータは使わない
                setGpsStatus("位置情報が古いため無視しました");
                return;
            }

            // ★ ③ 実処理は従来通り onPos に渡す
            onPos(pos);
        },
        (err) => {
            setGpsStatus("位置情報が取得できません");
        },
        {
            enableHighAccuracy: true,
            maximumAge: 3000,   // ★ 最大 3秒前までは許容
            timeout: 10000,     // ★ 10秒待ってダメならエラー
        }
    );
}

// ★ GPS監視停止
function stopGpsWatch() {
    if (gpsWatchId != null) {
        navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
    }
}


function startGuidance() {
    // ★ runtime のショートカット
    const rt = state.runtime;

    // ★ 案内開始時は一時ミュート解除
    rt.voiceMuted = false;
    const g = document.getElementById("screen-guidance");
    if (g && g._btnVoiceMute) {
        g._btnVoiceMute.classList.remove("muted");
    }

    // ★ 自動地下切替フラグ初期化
    rt.autoUndergroundReady = false;    

    // ★ ルート情報・フラグを初期化
    rt.started = true;
    rt.routeLocked = false;
    rt.routeLine = null;

    // 地下モード中は有楽町線として固定
    if (rt.undergroundMode) {
        rt.routeLocked = true;
        rt.routeLine = "yuraku";
        setGpsStatus("地下モード");
    }

    // ★ 途中駅列情変更フラグ初期化
    rt.midChangePending        = !!(state.config.endChange && state.config.second.trainNo && state.config.second.changeStation);
    rt.midChangeApplied        = false;
    rt.midChangeArrivalHandled = false;
    if (rt.midChangeConfirmTimer) {
        clearTimeout(rt.midChangeConfirmTimer);
        rt.midChangeConfirmTimer = null;
        rt.midChangeTriggerStation = null;
    }

    // ★ 前回案内の残りをリセット
    rt.lastSpoken = {};
    rt.lastStopStation = null;
    rt.lastPosition = null;
    rt.speedKmh = 0;
    rt.prevStationName = null;
    rt.prevStationDistance = null;
    rt.lastDepartStation = null;
    rt.lastDepartPrevDist = null;
    rt.lastStopDistance = null;
    // ★ 追加：速度算出の履歴・外れ値連続カウンタもリセット
    gpsSpeedHistory.length = 0;
    rt.speedOutlierStreak = 0;

    // ★ 追加停車駅：スタート時は 1本目を有効に
    rt.nonPassengerExtraStops = new Set(rt.nonPassengerExtraStops || []);
    // （2本目用の nonPassengerExtraStopsSecond は midChange で適用）    

    // ★ 起動モード開始（現在地から「現在駅＋次駅」を判定する）
    startStartupLocationDetection();

    // ★ UI の残りもリセット（遅延表示・次発時刻・音声表示・GPS表示）
    if (g) {
        if (g._speechText) g._speechText.textContent = "";
        if (g._gpsStatus)  g._gpsStatus.textContent  = "GPS";
        if (g._gpsSpeed)   g._gpsSpeed.textContent   = "— km/h";
        if (g._delayInfo) {
            g._delayInfo.textContent = "";
            g._delayInfo.style.visibility = "hidden";
        }
        clearNextDepartureDisplay();
        clearSegmentDisplay(); 
    }

    // ★ 案内画面中は画面消灯を防止
    requestWakeLock();

    renderGuidance();

    // 時計表示
    clockTimer = setInterval(() => {
        const d = new Date();
        document.getElementById("screen-guidance")._clock.textContent =
            `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    }, 200);

    // ★ 案内開始時にも念のため GPS 監視開始（開始画面側ですでに動いていれば何もしない）
    startGpsWatch();

    // ★ 遅延情報の定期取得を開始
    startDelayWatch();
}


function stopGuidance() {
    // ★ 案内終了：状態リセット＆画面消灯許可
    state.runtime.started = false;
    state.runtime.voiceMuted = false;   // ★ 追加
    releaseWakeLock();

	if (clockTimer) {
		clearInterval(clockTimer);
		clockTimer = null;
	}
    // ★ GPSも停止
    stopGpsWatch();
	
    // ★ 遅延情報更新も停止
    stopDelayWatch();

    // ★ 途中駅列情変更のタイマーも解除
    if (state.runtime.midChangeConfirmTimer) {
        clearTimeout(state.runtime.midChangeConfirmTimer);
        state.runtime.midChangeConfirmTimer = null;
    }

    state.runtime.midChangeTriggerStation = null;
    // ★ 追加：GPS点滅停止
    stopGpsBlink();
}

function renderGuidance() {
  const root = document.getElementById("screen-guidance");

  // 種別：縦書きバッジ
  root._badgeType.className =
    "badge badge-vertical " + typeClass(state.config.type);
  root._badgeType.textContent = state.config.type;

  root._cellNo.textContent   = state.config.trainNo;
  root._cellDest.textContent = state.config.dest;
}


function updateNotes(lat, lng, timeMs) {
    // 座標表示は廃止し、GPS 更新時刻の記録と状態更新のみ行う
    const rt = state.runtime;
    rt.lastGpsUpdate = Date.now();

    // 色判定を含む GPS 表示更新
    setGpsStatus("GPS");
}

function nearestStation(lat, lng) {
	let best = null,
		bestD = 1e12;

	// ★ 確定済みルート
	const lockedLine = state.runtime.routeLine;

	for (const [name, info] of Object.entries(state.datasets.stations)) {
 	   if (info.lat == null || info.lng == null) continue;

 	   // ★ ルート確定済みなら、そのルートに属さない駅は基本除外
 	   //    ただし、練馬・西所沢・小竹向原などの「共通駅」は許可する
 	   if (!stationBelongsToLockedLine(name, lockedLine)) {
 	       continue;
 	   }

 	   const d = haversine(lat, lng, info.lat, info.lng);
 	   if (d < bestD) {
 	       bestD = d;
  	      best = { name, ...info, distance: d };
  	  }
	}
	return best;
}

function clearSegmentDisplay() {
    const root = document.getElementById("screen-guidance");
    if (!root || !root._segmentInfo) return;
    root._segmentInfo.textContent = "";
    root._segmentInfo.style.visibility = "hidden";
}

function getLineOrderById(lineId) {
    if (lineId === "main") return MAIN_LINE_ORDER;
    if (lineId === "yuraku") return YURAKU_LINE_ORDER;
    if (lineId === "toshima") return TOSHIMA_LINE_ORDER;
    if (lineId === "sayama") return SAYAMA_LINE_ORDER;
    return null;
}

// 1つの路線配列上で「現在位置が属しそうな隣接駅ペア」を推定
function computeBestAdjacentPairOnLine(lat, lng, order) {
    const stations = state.datasets.stations;
    if (!stations || !order || order.length < 2) return null;

    let best = null;

    for (let i = 0; i < order.length - 1; i++) {
        const aName = order[i];
        const bName = order[i + 1];

        const aInfo = stations[aName];
        const bInfo = stations[bName];
        if (!aInfo || !bInfo) continue;
        if (aInfo.lat == null || aInfo.lng == null) continue;
        if (bInfo.lat == null || bInfo.lng == null) continue;

        const dA = haversine(lat, lng, aInfo.lat, aInfo.lng);
        const dB = haversine(lat, lng, bInfo.lat, bInfo.lng);
        const dAB = haversine(aInfo.lat, aInfo.lng, bInfo.lat, bInfo.lng);

        // 「線分に近い」ほど (dA + dB - dAB) が小さい
        const diff = (dA + dB - dAB);

        // ただし遠すぎるペアを選ばないよう、近さも軽く加点
        const score = diff + 0.05 * Math.min(dA, dB);

        if (!best || score < best.score) {
            best = {
                a: aName,
                b: bName,
                score,
                minDist: Math.min(dA, dB),
            };
        }
    }

    return best;
}

// 現在の「前駅⇒次駅」を決定（停車/通過は不問）
function computeCurrentSegmentPair(lat, lng) {
    const rt = state.runtime;

    // 1) ルートが確定しているなら、まずそれを優先
    if (rt.routeLine) {
        const lockedOrder = getLineOrderById(rt.routeLine);
        const lockedPair = lockedOrder
            ? computeBestAdjacentPairOnLine(lat, lng, lockedOrder)
            : null;

        // 近傍（だいたい 1.5km 以内）なら確定扱い
        if (lockedPair && lockedPair.minDist <= 1500) {
            const down = state.config.direction === "下り";
            return down
                ? { prev: lockedPair.a, next: lockedPair.b }
                : { prev: lockedPair.b, next: lockedPair.a };
        }
        // 近くないなら、全路線候補から拾い直す（誤ロック対策）
    }

    // 2) 全候補路線から「最も筋が良い隣接ペア」を選ぶ
    const candidates = [
        { id: "main", order: MAIN_LINE_ORDER },
        { id: "yuraku", order: YURAKU_LINE_ORDER },
        { id: "toshima", order: TOSHIMA_LINE_ORDER },
        { id: "sayama", order: SAYAMA_LINE_ORDER },
    ];

    let best = null;

    for (const c of candidates) {
        const p = computeBestAdjacentPairOnLine(lat, lng, c.order);
        if (!p) continue;

        if (!best || p.score < best.score) {
            best = { ...p, lineId: c.id };
        }
    }

    if (!best) return null;

    // 3) あまりに遠い場合は表示しない（GPSが飛んだ等）
    if (best.minDist > 5000) return null;

    const down = state.config.direction === "下り";
    return down
        ? { prev: best.a, next: best.b }
        : { prev: best.b, next: best.a };
}

function updateSegmentDisplay(ns, lat, lng) {
    const root = document.getElementById("screen-guidance");
    if (!root || !root._segmentInfo) return;

    // 地下モード中は表示しない
    if (state.runtime.undergroundMode) {
        clearSegmentDisplay();
        return;
    }

    // routeLine を更新してから推定精度を上げる（分岐付近）
    if (ns) {
        updateRouteLock(ns);
    }

    // 駅 200m 圏内は「ただいま駅」
    if (ns && ns.name && typeof ns.distance === "number" && ns.distance <= 200) {
        root._segmentInfo.textContent = `ただいま${ns.name}`;
        root._segmentInfo.style.visibility = "visible";
        return;
    }

    // 駅間表示（前駅⇒次駅）
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        clearSegmentDisplay();
        return;
    }

    const seg = computeCurrentSegmentPair(lat, lng);
    if (!seg) {
        clearSegmentDisplay();
        return;
    }

    root._segmentInfo.textContent = `${seg.prev}⇒${seg.next}`;
    root._segmentInfo.style.visibility = "visible";
}


// ★ 遅延情報の取得＆画面反映
async function fetchAndUpdateDelay() {
    const root = document.getElementById("screen-guidance");
    if (!root || !state.runtime.started) return;

    const delayEl = root._delayInfo;
    if (!delayEl) return;

    const trainNo = getCurrentTrainNoForDelay();
    if (!trainNo) {
        delayEl.textContent = "";
        delayEl.style.visibility = "hidden";
        return;
    }

    const lineIds = getCurrentLineIdsForDelay();
    let foundDelay = null;
    let anyResponse = false;
    let currentToStationName = null;

    for (const lineId of lineIds) {
        try {
            const res = await fetch(
                `https://train.seibuapp.jp/trainfo-api/ti/v1.0/trains?lineId=${lineId}&detail=0&adminFlg=1`,
            );
            if (!res.ok) continue;
            anyResponse = true;

            const data = await res.json();
            const list = (data && data.train) || [];

            const tr = list.find(
                (t) => String(t.trainNo) === trainNo,
            );
            if (tr) {
                const d = Number(tr.delay ?? 0);
                if (!Number.isNaN(d)) {
                    foundDelay = d;
                }

                const toName =
                    tr.toStationName ||
                    tr["toStationName"] ||
                    tr.toStation ||
                    tr["行先駅名"] ||
                    null;

                if (toName) {
                    currentToStationName = String(toName).trim();
                }

                break;
            }
        } catch (e) {
            // 通信エラーは無視して次の路線へ
        }
    }

    if (foundDelay != null) {
        if (foundDelay > 0) {
            const m = String(foundDelay).padStart(2, "0");
            delayEl.textContent = `遅延 ${m} 分`;
            delayEl.style.visibility = "visible";
            delayEl.style.opacity = "1";
        } else {
            delayEl.textContent = "";
            delayEl.style.visibility = "hidden";
        }
    } else {
        if (anyResponse) {
            delayEl.textContent = "遅延不明";
            delayEl.style.visibility = "visible";
            delayEl.style.opacity = "0.4";
        } else {
            delayEl.textContent = "";
            delayEl.style.visibility = "hidden";
        }
    }

    // ★ 上り・小竹向原行き：練馬停車後、trains API の toStationName が新桜台になったら地下モードへ
    if (
        !state.runtime.undergroundMode &&
        state.runtime.autoUndergroundReady &&
        state.config.direction === "上り" &&
        state.config.dest === "小竹向原" &&
        currentToStationName &&
        (currentToStationName === "新桜台" || currentToStationName === "小竹向原")
    ) {
        enterUndergroundMode("autoUp");
        state.runtime.autoUndergroundReady = false;
    }

    // ★ 地下モード時：toStationName を使って現在位置相当を処理
    if (state.runtime.undergroundMode && currentToStationName) {
        handleUndergroundToStationName(currentToStationName);
    }
}



// ★ 次駅発車時刻表示を消す
function clearNextDepartureDisplay() {
    const root = document.getElementById("screen-guidance");
    if (!root || !root._nextDepart) return;
    root._nextDepart.textContent = "";
    root._nextDepart.style.visibility = "hidden";
}

// ★ 起動判定モードを開始（地点リセット共通）
function startStartupLocationDetection() {
    const rt = state.runtime;

    rt.startupMode = true;
    rt.startupFixed = false;
    rt.startupCandidate = null;
    rt.startupCount = 0;
    // ★ 追加：起動判定開始時刻（速度に頼らず「いつまでも確定しない」を避けたい場合に使える）
    rt.startupSince = Date.now();

    // 位置に依存する情報をリセット
    rt.prevStationName = null;
    rt.prevStationDistance = null;
    rt.lastStopStation = null;
    rt.lastDepartStation = null;
    rt.lastDepartPrevDist = null;
    rt.lastStopDistance = null;

    // 次駅発車時刻もいったんクリア
    clearNextDepartureDisplay();
}

// ★ 「駅に停車中」と確定したときの初期化
function initStartupAtStation(stationName) {
    const rt = state.runtime;

    // 念のため、この駅は停車扱いにしておく（臨時停車など）
    rt.passStations.delete(stationName);

    // 現在の停車駅情報
    rt.prevStationName = stationName;
    rt.prevStationDistance = 0;
    rt.lastDepartStation = stationName;
    rt.lastDepartPrevDist = 0;
    rt.lastStopDistance = 0;

    // 次に停車する駅を決定して保存（※「発車後190m」で次駅案内＆次駅発車時刻へ切替するため）
    const nextName = findNextStopStationName(stationName);
    rt.lastStopStation = nextName || null;

    // 発車時刻表示をいったんクリア
    clearNextDepartureDisplay();

    // ★ ここが変更点：
    //   駅の200m圏内で開始/地点リセットした場合は
    //   「次駅」ではなく「現在駅」の発車時刻を表示する
    fetchAndShowNextDeparture(stationName);
}


// ★ 「駅間を走行中」にスタートしたときの初期化
function initStartupBetween(ns) {
    const rt = state.runtime;

    // 「最後に見た駅」として最近傍駅を入れておく
    rt.prevStationName = ns.name;
    rt.prevStationDistance = ns.distance;

    // 直前に通過した駅も「最近傍駅」とみなしておく
    rt.lastDepartStation = ns.name;
    rt.lastDepartPrevDist = ns.distance;
    rt.lastStopDistance = null;   // 駅での停止距離は不明なので null

    // ★ 最寄り駅＋方向・行先・ルート情報から、
    //    「これから停車する次の駅」を無理やり推定する
    const nextName = findNextStopStationName(ns.name);
    rt.lastStopStation = nextName || null;

    // 次駅表示はいったんクリア
    clearNextDepartureDisplay();

    // ★ 判定に成功したら、その駅の発車時刻を取得して表示
    if (nextName) {
        fetchAndShowNextDeparture(nextName);
    }
}

// ★ 起動モード中の「現在駅＋次駅」判定ロジック（速度は使わない）
function handleStartupPosition(ns) {
    const rt = state.runtime;
    if (!rt.startupMode || !ns) return;

    // ★ 起動判定中もルートロックを更新しておく
    updateRouteLock(ns);

    // すでに確定済みなら何もしない
    if (rt.startupFixed) {
        rt.startupMode = false;
        return;
    }

    // ★ 判定基準：駅200m圏内かどうかだけで「駅 / 駅間」を分ける
    const inStationArea =
        typeof ns.distance === "number" &&
        Number.isFinite(ns.distance) &&
        ns.distance <= 200;

    // 1) 駅と駅の間（= 200m圏外） → 即「駅間起動」で確定
    if (!inStationArea) {
        initStartupBetween(ns);
        rt.startupMode = false;
        rt.startupFixed = true;
        return;
    }

    // 2) 駅にいる（= 200m圏内）
    //    同じ駅を連続で拾えたら「駅停車中」として確定（速度は見ない）
    if (rt.startupCandidate === ns.name) {
        rt.startupCount = (rt.startupCount || 0) + 1;
    } else {
        rt.startupCandidate = ns.name;
        rt.startupCount = 1;
    }

    // ★ 3回連続で同一駅なら確定（従来の安定化だけ残す）
    if (rt.startupCount >= 3) {
        initStartupAtStation(ns.name);
        rt.startupMode = false;
        rt.startupFixed = true;
        return;
    }

    // （任意）万一いつまでも確定しないと困るなら、タイムアウトで駅確定
    // 速度は使わず、時間だけでフォールバックする
    const since = rt.startupSince || Date.now();
    if (Date.now() - since > 8000) { // 8秒は好みで調整OK
        initStartupAtStation(ns.name);
        rt.startupMode = false;
        rt.startupFixed = true;
        return;
    }
}



// ★ 遅延更新タイマー開始（1分おき）
function startDelayWatch() {
    if (delayTimer) return;
    fetchAndUpdateDelay(); // 起動時に一度実行
    delayTimer = setInterval(fetchAndUpdateDelay, 20000);
}

// ★ 遅延更新タイマー停止
function stopDelayWatch() {
    if (delayTimer) {
        clearInterval(delayTimer);
        delayTimer = null;
    }
}


function onPos(pos) {
    const { latitude, longitude } = pos.coords;

    const now = Date.now();
    const gpsTime = pos.timestamp;
    const ageMs = now - gpsTime;

    // ★ 追加保険：watchPosition 側でもチェックしているが、ここでも10秒以上前は無視
    if (ageMs > 10000) {
        setGpsStatus("位置情報が古いため無視しました");
        return;
    }

    // =========================================================
    // ★ 速度計算（外れ値連続→リセット ＋ GPS速度も参考）
    // =========================================================
    const rt = state.runtime;

    // GPSが提供する速度（m/s）→ km/h（無いことも多い）
    const gpsSpeedMps = pos.coords.speed;
    const gpsSpeedKmh =
        typeof gpsSpeedMps === "number" &&
        Number.isFinite(gpsSpeedMps) &&
        gpsSpeedMps >= 0
            ? Math.min(gpsSpeedMps * 3.6, 200) // 上限は安全側で丸め
            : null;

    // outlier カウンタが無い場合の保険
    if (typeof rt.speedOutlierStreak !== "number") {
        rt.speedOutlierStreak = 0;
    }

    // 現在値（前回値）
    const prevSpeed =
        typeof rt.speedKmh === "number" && Number.isFinite(rt.speedKmh)
            ? rt.speedKmh
            : 0;

    let newSpeedKmh = prevSpeed;

    // 履歴に入れて中央値を返す
    function pushAndMedian(v) {
        // v を安全側に丸め
        if (!Number.isFinite(v) || v < 0) v = 0;
        if (v > 200) v = 200;

        gpsSpeedHistory.push(v);
        if (gpsSpeedHistory.length > GPS_SPEED_HISTORY_SIZE) {
            gpsSpeedHistory.shift();
        }

        const sorted = [...gpsSpeedHistory].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 1
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    // 位置差分からの瞬間速度（km/h）
    let instSpeed = null;

    if (rt.lastPosition) {
        const dt = (gpsTime - rt.lastPosition.time) / 1000; // 秒

        // dt が極端に小さすぎ/大きすぎると速度が壊れるので除外
        if (dt > 0.3 && dt < 30) {
            const dist = haversine(
                rt.lastPosition.lat,
                rt.lastPosition.lng,
                latitude,
                longitude
            );
            instSpeed = (dist / dt) * 3.6;
        }
    }

    if (instSpeed != null && Number.isFinite(instSpeed)) {
        // instSpeed 自体の粗いガード
        if (instSpeed < 0) instSpeed = 0;
        if (instSpeed > 250) instSpeed = 250; // 判定用の上限（採用時は 200 に丸める）

        const delta = Math.abs(instSpeed - prevSpeed);

        // 従来：±60km/h 未満なら採用
        let accept = delta < 60;

        // ★ 追加：GPS速度が取れていて、inst と近ければ採用（固定化救済）
        if (!accept && gpsSpeedKmh != null) {
            if (Math.abs(instSpeed - gpsSpeedKmh) <= 25) {
                accept = true;
            }
        }

        if (accept) {
            rt.speedOutlierStreak = 0;

            // ★ GPS速度がある場合は、近いなら平均、遠いなら「より妥当そうな方」を採用
            let sample = instSpeed;

            if (gpsSpeedKmh != null) {
                const diffIG = Math.abs(instSpeed - gpsSpeedKmh);

                if (diffIG <= 30) {
                    sample = (instSpeed + gpsSpeedKmh) / 2;
                } else {
                    // prev に近い方を採用（急ジャンプを抑える）
                    sample =
                        Math.abs(gpsSpeedKmh - prevSpeed) < Math.abs(instSpeed - prevSpeed)
                            ? gpsSpeedKmh
                            : instSpeed;
                }
            }

            newSpeedKmh = pushAndMedian(sample);
        } else {
            // 外れ値扱い
            rt.speedOutlierStreak += 1;

            // ★ 外れ値が 5 回以上連続したら、履歴をリセットして再学習
            if (rt.speedOutlierStreak >= 5) {
                gpsSpeedHistory.length = 0;
                rt.speedOutlierStreak = 0;

                // 初期値は GPS速度が取れればそれ、無ければ instSpeed（ただし上限丸め）
                const seed =
                    gpsSpeedKmh != null
                        ? gpsSpeedKmh
                        : (instSpeed <= 200 ? instSpeed : 0);

                newSpeedKmh = pushAndMedian(seed);
            } else {
                // リセット条件に達するまでは前回値を維持
                newSpeedKmh = prevSpeed;
            }
        }
    } else {
        // instSpeed を出せない場合：GPS速度が取れるならそれで更新（緩やかに）
        if (gpsSpeedKmh != null) {
            rt.speedOutlierStreak = 0;
            newSpeedKmh = pushAndMedian(gpsSpeedKmh);
        } else {
            // どちらも無いなら維持
            newSpeedKmh = prevSpeed;
        }
    }

    rt.speedKmh = newSpeedKmh;

    // ★ 最新位置を保存
    rt.lastPosition = {
        lat: latitude,
        lng: longitude,
        time: gpsTime
    };

    // ★ 本当の GPS 時刻で表示
    updateNotes(latitude, longitude, gpsTime);

    // ★ 最寄り駅判定（ルートロック付き）
    const ns = nearestStation(latitude, longitude);

    // ★ 駅間表示（地下モード中は updateSegmentDisplay 内で非表示）
    updateSegmentDisplay(ns, latitude, longitude);

    // ★ 下りの地下モード中に、練馬200m以内に入ったら自動で地上モードへ（池袋線本線）
    if (
        rt.undergroundMode &&
        state.config.direction === "下り" &&
        ns &&
        ns.name === "練馬" &&
        ns.distance <= 210
    ) {
        exitUndergroundMode("main", { forceStationName: "練馬" });
    }

    // ★ 起動モード中なら「現在駅＋次駅」を決めるロジックを先に実行
    handleStartupPosition(ns);

    // ★ 駅案内ロジック
    maybeSpeak(ns);

    // ★ 車両アイコン
    let show = true;
    if (ns && rt.passStations.has(ns.name) && ns.distance <= 500) {
        show = false;
    }

    band1RenderCars(
        document.getElementById("screen-guidance")._band1,
        show,
        state.config.cars
    );
}


function isNonPassenger(t) {
    return /(回送|試運転|臨時)/.test(t);
}

// ==== Sトレイン特例判定 ====

// 「SトレA」「SトレB上」「SトレB下」（将来 "SトレB" 表記でも拾えるように）
function isSTrain(t) {
    const s = String(t || "").trim();
    return s === "SトレA" || /^SトレB/.test(s);
}

// 「運転停車、ドア扱い注意」を練馬到着時に出す対象
// ・SトレA（方向問わず）
// ・上りのSトレB（= B上想定。安全側で direction==="上り" の B 系を拾う）
function needsSTrainOpStopAtNerima(t, direction) {
    const s = String(t || "").trim();
    if (s === "SトレA") return true;
    if (direction === "上り" && /^SトレB/.test(s)) return true;
    return false;
}

// 「ホームドア表示灯『S』確認」を到着後に出す駅
const STRAIN_HOME_S_STATIONS = new Set([
    "練馬",
    "石神井公園",
    "保谷",
    "所沢",
]);


// ★ 途中駅列情変更：どの駅の「190m通過」で切り替えるかを決める
function computeMidChangeTriggerStation(fromName, targetName, direction) {
    const lineId = getLineForStation(fromName);
    let line = null;

    if (lineId === "main")      line = MAIN_LINE_ORDER;
    else if (lineId === "yuraku")  line = YURAKU_LINE_ORDER;
    else if (lineId === "toshima") line = TOSHIMA_LINE_ORDER;
    else if (lineId === "sayama")  line = SAYAMA_LINE_ORDER;
    else return fromName; // 不明な場合は従来どおり「出発駅で切り替え」

    const idxFrom   = line.indexOf(fromName);
    const idxTarget = line.indexOf(targetName);
    if (idxFrom === -1 || idxTarget === -1) {
        return fromName;
    }

    // 進行方向と配列の並びが矛盾していたら諦めて出発駅扱い
    if (direction === "下り" && idxFrom >= idxTarget) {
        return fromName;
    }
    if (direction === "上り" && idxFrom <= idxTarget) {
        return fromName;
    }

    // 「変更駅の一つ手前」側から探す：変更駅に一番近い通過駅を優先
    // （= 一番最後に通る通過駅）
    if (direction === "下り") {
        // from → ... → target（インデックス増加方向）
        for (let i = idxTarget - 1; i > idxFrom; i--) {
            const name = line[i];
            const isStop = !state.runtime.passStations.has(name);
            if (!isStop) {
                return name;    // 変更駅の一つ手前の「通過駅」
            }
        }
    } else {
        // 上り：from → ... → target（インデックス減少方向）
        for (let i = idxTarget + 1; i < idxFrom; i++) {
            const name = line[i];
            const isStop = !state.runtime.passStations.has(name);
            if (!isStop) {
                return name;
            }
        }
    }

    // 間に通過駅が無かった場合 → 従来通り「出発駅」で切り替え
    return fromName;
}

// ★ 実際に「後半列車」の情報へ切り替える処理
function applyMidTrainChange() {
    const cfg2 = state.config.second || {};
    if (!state.config.endChange || !cfg2.trainNo) return;

    // 列車情報を後半列車に上書き
    state.config.trainNo = cfg2.trainNo || state.config.trainNo;
    state.config.type    = cfg2.type    || state.config.type;
    state.config.dest    = cfg2.dest    || state.config.dest;
    state.config.cars    = cfg2.cars    || state.config.cars;

    // 追加停車駅セットも後半列車用に切替
    state.runtime.nonPassengerExtraStops = new Set(
        state.runtime.nonPassengerExtraStopsSecond || []
    );

    // 種別が変わるので停車パターンを再構築
    buildPassStationList();

    state.runtime.midChangePending        = false;
    state.runtime.midChangeApplied        = true;
    state.runtime.midChangeTriggerStation = null;

    // 画面の表示（種別バッジ・列番・行先）も更新しておく
    renderGuidance();

    // 「列情変更」「方向幕確認」の案内をここで実施
    speakOnce("midchange_change", "列情変更");
    speakOnce("midchange_maku", "方向幕確認");
}


function maybeSpeak(ns) {
    if (!ns) return;

    // ★ ルート確定
    updateRouteLock(ns);

    const t = state.config.type;
    const d = state.runtime.speedKmh;

    // ★ 回送/試運転/臨時かどうか（ドア扱い注意の制御に使う）
    const isNonP = isNonPassenger(t);

    // ★ 前回の最近傍駅と距離
    const prevName = state.runtime.prevStationName;
    const prevDist = state.runtime.prevStationDistance;
    const prevSameDist = prevName === ns.name ? prevDist : null;

    const isFirstMeasurement =
        state.runtime.prevStationName === null &&
        state.runtime.prevStationDistance === null;

    // ★ 通過駅トリガーでの途中駅列情変更
    //   （通過駅を 190m 離れたタイミングで“論理的に”後半列車へ切替）
    const left190Any =
        !isFirstMeasurement &&
        prevSameDist != null &&
        prevSameDist <= 190 &&
        ns.distance > 190;

    if (
        left190Any &&
        state.config.endChange &&
        state.runtime.midChangePending &&
        state.runtime.midChangeTriggerStation &&
        ns.name === state.runtime.midChangeTriggerStation
    ) {
        applyMidTrainChange();
    }

    // 特記事項
    otherSpeaks(ns);

    const key = ns.name;

    const baseStop = baseIsStop(ns.name);
    const isStop = !state.runtime.passStations.has(ns.name);

    const isExtraStop = !baseStop && isStop; // 本来通過→いま停車
    const isExtraPass = baseStop && !isStop; // 本来停車→いま通過

    // ===== (A) 前駅発車後の「次は○○」案内 =====
    // 190m 以下の位置から 190m 超に抜けた瞬間のみ発報
    // ★ lastStopStation が未決定でもトリガーするように変更
    const left190 =
        !isFirstMeasurement &&
        isStop &&  
        prevSameDist != null &&
        prevSameDist <= 190 &&
        ns.distance > 190;

    if (left190) {
        let nextName = state.runtime.lastStopStation;

        // ★ 200m 以内で次停車駅が決まっていなかった場合、
        //    190m を離れるタイミングで再度判定する
        if (!nextName) {
            nextName = findNextStopStationName(ns.name);
            state.runtime.lastStopStation = nextName || null;
        }

        // 次駅発車時刻はいったん消す（後で再取得）
        clearNextDepartureDisplay();

        if (nextName) {
            // ★ ここで「途中駅で列情変更」の対象かどうかを判定
            const cfg2 = state.config.second || {};
            const isMidChangeTarget =
                state.config.endChange &&
                state.runtime.midChangePending &&
                cfg2.changeStation &&
                nextName === cfg2.changeStation;

            // ★ 対象なら「切替トリガー駅（通過駅）」を決めて予約する
            if (isMidChangeTarget) {
                const rt = state.runtime;

                // まだトリガー駅が未設定なら決める（毎回上書きしない）
                if (!rt.midChangeTriggerStation) {
                    const trigger = computeMidChangeTriggerStation(
                        ns.name,                // いま発車した駅（停車駅）
                        cfg2.changeStation,     // 変更駅
                        state.config.direction
                    );

                    rt.midChangeTriggerStation = trigger;

                    // ★ 変更駅までに通過駅が無い（trigger が発車駅そのもの）なら
                    //   従来どおり、ここで即切替してOK
                    if (trigger === ns.name) {
                        applyMidTrainChange();
                    }
                }
            }

            // ★ ここから先の判定は、すでに変更後種別で行われる
            const baseNextStop = baseIsStop(nextName);
            const isNextStop   = !state.runtime.passStations.has(nextName);

            const isExtraStopNext = !baseNextStop && isNextStop;
            const isExtraPassNext = baseNextStop && !isNextStop;

            if (isNextStop) {
                const word = isExtraStopNext ? "臨時停車" : "停車";

                const plat = getEffectivePlatformForStation(nextName);

                let text;
                if (plat) {
                    text = `次は${nextName}、${plat}番、${word}`;
                } else {
                    text = `次は${nextName}、${word}`;
                }

                if (isPlatformChanged(nextName)) {
                    text += "、着発線変更";
                }

                // ★ まず「次は〜」を案内（190m地点）
                speakOnce("leave190_" + nextName, text);

                // ★ 途中駅列情変更の対象であれば、続けて「列情変更」「方向幕確認」
                const cfg2b = state.config.second || {};
                const isMidChangeTargetNow =
                    state.config.endChange &&
                    cfg2b.changeStation &&
                    nextName === cfg2b.changeStation &&
                    state.runtime.midChangeApplied;

                if (isMidChangeTargetNow) {
                    speakOnce("midchange_change", "列情変更");
                    speakOnce("midchange_maku", "方向幕確認");
                }

                // ★ 判定に成功したので、この駅の発車時刻を取得して表示
                fetchAndShowNextDeparture(nextName);

            } else if (isExtraPassNext) {
                speakOnce(
                    "leave190_" + nextName,
                    `次は${nextName}、臨時通過`,
                );
            }
        }

        state.runtime.lastStopStation = null;
        state.runtime.lastDepartStation = null;
        state.runtime.lastDepartPrevDist = null;
    }

    // ===== (B) 手前 400m の「まもなく○○」案内 =====
    // 400m より外側 → 400m 以内に入った瞬間
    const crossed400 =
        !isFirstMeasurement &&
        isStop &&
        ns.distance <= 400 &&
        (prevSameDist == null || prevSameDist > 400);

    if (crossed400) {
        const stopWord = isExtraStop ? "臨時停車" : "停車";

        let text = `まもなく${ns.name}、${stopWord}、${state.config.cars}両`;

        // ★ この駅が着発線変更されている場合のみ付加
        if (isPlatformChanged(ns.name)) {
            text += "、着発線変更";
        }

        speakOnce("arr400_" + key, text);

        // ★ 回送・試運転・臨時は 400m 案内の直後に「ドア扱い注意」
        if (isNonP) {
            speakOnce("door400_" + key, "ドア扱い注意");
        }
    }

    // ===== (C) 停止直前の案内：200m クロス時 =====
    // 200m より外側 → 200m 以内に入った瞬間
    const crossed200Stop =
        !isFirstMeasurement &&
        isStop &&
        ns.distance <= 200 &&
        (prevSameDist == null || prevSameDist > 200);

    // ★ 速度条件は撤廃済み：距離条件だけで判定
    if (crossed200Stop) {
        const stopWord = isExtraStop ? "臨時停車" : "停車";

        // 到着案内（速度に関係なく一度だけ出す）
        if (
            state.config.cars === 8 &&
            (state.config.direction === "上り" ? ns.up8pos : ns.down8pos)
        ) {
            speakOnce(
                "arr200_" + key,
                `${stopWord}、8両、${
                    state.config.direction === "上り"
                        ? ns.up8pos
                        : ns.down8pos
                }あわせ`,
            );
        } else if (state.config.cars === 10) {
            speakOnce("arr200_" + key, `${stopWord}、10両`);
        } else {
            speakOnce(
                "arr200_" + key,
                `${stopWord}、${state.config.cars}両、停止位置注意`,
            );
        }
        
        // ★ 上り・小竹向原行き：練馬に停車したら「発車後に自動地下切替」待機を立てる
        if (
            state.config.direction === "上り" &&
            state.config.dest === "小竹向原" &&
            ns.name === "練馬"
        ) {
            state.runtime.autoUndergroundReady = true;
        }

        // ★ 回送・試運転・臨時は 200m 案内の直後にも「ドア扱い注意」
        if (isNonP) {
            speakOnce("door200_" + key, "ドア扱い注意");
        }

        // ★ Sトレイン特例（到着時）
        if (isSTrain(t)) {
            // 1) 練馬/石神井公園/保谷/所沢：ホームドア表示灯「S」確認（先に）
            if (STRAIN_HOME_S_STATIONS.has(ns.name)) {
                speakOnce("strain_homeS_" + key, "ホームドア表示灯「S」確認");
            }

            // 2) 練馬：SトレA と 上りSトレB → 「運転停車、ドア扱い注意」（後に）
            if (ns.name === "練馬" && needsSTrainOpStopAtNerima(t, state.config.direction)) {
                speakOnce("strain_opstop_" + key, "運転停車、ドア扱い注意");
            }
        }

        // ★ 次駅情報は必ずセット（この後の「次は〜」案内用）
        //    地点リセット／地下復帰直後は lastStopStation に「これから停車する駅」が
        //    すでに入っていることがある（= 今到着した駅名と同一になる）ため、
        //    到着駅から見た「次の停車駅」に更新しておく。
        if (
            !state.runtime.lastStopStation ||
            state.runtime.lastStopStation === ns.name
        ) {
            const nextName = findNextStopStationName(ns.name);
            state.runtime.lastStopStation = nextName || null;
        }

        // ★ ここから追加：途中駅列情変更の「変更駅」に到着したタイミング
        const cfg2 = state.config.second || {};
        const isChangeStation =
            state.runtime.midChangeApplied &&
            !state.runtime.midChangeArrivalHandled &&
            cfg2.changeStation &&
            ns.name === cfg2.changeStation;

        if (isChangeStation) {
            const root = document.getElementById("screen-guidance");
            if (root) {
                // 案内画面の種別・列番・行先を変更後のものに更新
                if (root._badgeType) {
                    // ★ 縦書きクラスを維持する
                    root._badgeType.className = "badge badge-vertical " + typeClass(state.config.type);
                    root._badgeType.textContent = state.config.type;
                }
                if (root._cellNo) {
                    root._cellNo.textContent = state.config.trainNo;
                }
                if (root._cellDest) {
                    root._cellDest.textContent = state.config.dest;
                }
            }

            // 20秒後に「列情確認」
            if (state.runtime.midChangeConfirmTimer) {
                clearTimeout(state.runtime.midChangeConfirmTimer);
            }
            state.runtime.midChangeConfirmTimer = setTimeout(() => {
                speakOnce("midchange_confirm", "列情確認");
            }, 20000);

            state.runtime.midChangeArrivalHandled = true;
        }
    }

    // ===== 通過列車の案内 =====
    // （客扱い列車・回送・試運転・臨時すべて共通）
    if (!isStop && ns.distance <= 200 && d <= 45) {
        const passWord = isExtraPass ? "臨時通過" : "通過";
        speakOnce("pass200_" + key, `種別${t}、${passWord}`);
    }
    if (!isStop && ns.distance <= 120 && d <= 30) {
        const passWord = isExtraPass ? "臨時通過" : "通過";
        speakOnce("pass120_" + key, `種別${t}、${passWord}、速度注意`);
    }

    // ★ 次回比較用距離を保存
    state.runtime.prevStationName = ns.name;
    state.runtime.prevStationDistance = ns.distance;
}



function otherSpeaks(ns) {
    const h = new Date();
    const hh = h.getHours(), mm = h.getMinutes();
    const after1555 = hh > 15 || (hh === 15 && mm >= 55);
    const before0100 = hh < 1;
    const timeOK = after1555 || before0100;

    // 練馬：100m 内 → 外 に出た瞬間
    if (
        state.config.direction === "上り" &&
        state.config.dest === "小竹向原" &&
        ns.name === "練馬"
    ) {
        const prevDist =
            state.runtime.prevStationName === "練馬"
                ? state.runtime.prevStationDistance
                : null;

        const crossedOut =
            prevDist != null &&
            prevDist <= 100 &&
            ns.distance > 100;

        if (crossedOut) {
            speakOnce("rule-nerima", "搭載かばん、確認");
        }
    }

    // 新宿線直通：所沢 400m 以内
    if (
        state.config.direction === "上り" &&
        /新宿線/.test(state.config.dest) &&
        ns.name === "所沢" &&
        ns.distance <= 400
    ) {
        speakOnce("rule-tokorozawa", "列車無線チャンネル切り替え");
    }

    // ★ 椎名町（池袋行・上り）
    //    220m 以下 → 220m 以上 に抜けた瞬間で発話
    if (
        state.config.direction === "上り" &&
        state.config.dest === "池袋" &&
        ns.name === "椎名町"
    ) {
        const prevDist =
            state.runtime.prevStationName === "椎名町"
                ? state.runtime.prevStationDistance
                : null;

        const crossed220Out =
            prevDist != null &&
            prevDist <= 220 &&
            ns.distance >= 220;   // ★ 「220m以下」→「220m以上」に出た瞬間

        if (crossed220Out) {
            // ドア扱い確認：夕方〜深夜のみ（従来どおり時間帯指定）
            if (timeOK) {
                speakOnce("rule-shiinamachi", "ドアかいひかた、確認");
            }
            // 方向幕確認：時間帯に関係なく必ず実施
            speakOnce("rule-shiinamachi_maku", "方向幕確認");
        }
    }
}



// ★ 回送・試運転・臨時用 追加停車駅設定画面
function screenExtraStops() {
    const root = el("div", { class: "screen", id: "screen-extra-stops" });

    const c = el("div", { class: "container", id: "extraStopsContainer" });
    root.appendChild(
        el("h2", {}, "追加停車駅の設定")
    );
    root.appendChild(
        el("p", {}, "ダイヤ上で必ず停車する駅に加えて、停車する駅を選択してください。")
    );
    root.appendChild(c);

    const btnRow = el("div", { class: "row", style: "margin-top:8px;gap:8px;" }, [
        el(
            "button",
            { class: "btn secondary", id: "extraBack" },
            "戻る"
        ),
        el(
            "button",
            { class: "btn", id: "extraNext" },
            "開始画面へ"
        ),
    ]);
    root.appendChild(btnRow);

    // ボタンの動作
    root.addEventListener("click", (e) => {
    	if (e.target.id === "extraBack") {
    		// 設定画面に戻る
    		state.runtime.extraStopsQueue = [];
    		state.runtime.extraStopsMode  = null;
    		root.classList.remove("active");
	    	document.getElementById("screen-settings").classList.add("active");
    
	    } else if (e.target.id === "extraNext") {
	    	// チェックされた駅を保存
	    	const newExtras = new Set();
	    	const blocks = root.querySelectorAll(".extra-station-block");
    
	    	blocks.forEach((block) => {
	    		const name = block.getAttribute("data-station");
    			const base = block.getAttribute("data-base") === "1";
    			const chk = block.querySelector('input[type="checkbox"]');
    			if (!base && chk && chk.checked) {
    				newExtras.add(name);
    			}
    		});
    
    		const mode = state.runtime.extraStopsMode || "first";
    		if (mode === "second") {
    			state.runtime.nonPassengerExtraStopsSecond = newExtras;
    		} else {
    			// 1本目（従来の回送など）
    			state.runtime.nonPassengerExtraStops = newExtras;
    		}
    
    		// ★ 次のモードがあれば再度この画面を使う
    		if (state.runtime.extraStopsQueue && state.runtime.extraStopsQueue.length > 0) {
    			const nextMode = state.runtime.extraStopsQueue.shift();
    			state.runtime.extraStopsMode = nextMode;
    			renderNonPassengerExtraStopsScreen();  // 次のモードで再描画
    			// 画面はそのまま（screen-extra-stops のまま）
    			return;
    		}
    
    		// ★ もうキューが無い → ここで初めて開始画面へ
    		state.runtime.extraStopsMode = null;
    
    		// 案内開始時のデフォルトは 1本目のセット
    		state.runtime.nonPassengerExtraStops = new Set(
    			state.runtime.nonPassengerExtraStops || []
    		);
    
             // GPS開始 → 開始画面へ
            startGpsWatch();
            root.classList.remove("active");
            const startRoot = document.getElementById("screen-start");
            if (startRoot) {
                startRoot.classList.add("active");
                if (startRoot._updateUndergroundButtonVisibility) {
                    startRoot._updateUndergroundButtonVisibility();
                }
            }

    	}
    });

    return root;
}


function init() {
	const app = document.getElementById("app");
	app.append(screenSettings());
	app.append(screenStart());
	app.append(screenGuidance());
    app.append(screenExtraStops()); 
}

// ★ 追加停車駅画面のリストを描画
function renderNonPassengerExtraStopsScreen() {
    const root = document.getElementById("screen-extra-stops");
    if (!root) return;

    // まず既存のブロックを全部消す（念のため二重クリア）
    root.querySelectorAll(".extra-station-block").forEach((el) => el.remove());

    // コンテナを取得（なければ作る）
    let container = root.querySelector("#extraStopsContainer");
    if (!container) {
        container = el("div", { class: "container", id: "extraStopsContainer" });
        const btnRow = root.querySelector("#extraStopsButtons");
        if (btnRow) {
            root.insertBefore(container, btnRow);
        } else {
            root.appendChild(container);
        }
    } else {
        container.innerHTML = "";
    }

    const stations = state.datasets.stations;
    if (!stations) {
        container.appendChild(
            el("div", { class: "row" }, "stations.json が読み込まれていません。"),
        );
        return;
    }

    const names = Object.keys(stations);

    // ★ モードに応じて、どの種別で「必須停車駅」を判定するか決める
    const mode = state.runtime.extraStopsMode || "first";

    let extraSet;
    let baseType;

    if (mode === "second") {
        // 変更後列車（回送・臨時など）の追加停車駅
        extraSet = state.runtime.nonPassengerExtraStopsSecond || new Set();
        baseType = state.config.second.type || "";
    } else {
        // 変更前列車（1本目）の追加停車駅
        extraSet = state.runtime.nonPassengerExtraStops || new Set();
        baseType = state.config.type || "";
    }

    names.forEach((n) => {
        // ★ ここがポイント：モードごとの種別で「ダイヤ上必須停車駅」を判定
        const base = baseIsStopRawForType(n, baseType);

        const block = el("div", {
            class: "extra-station-block",
            "data-station": n,
            "data-base": base ? "1" : "0",
            style: "margin-bottom:4px;border-bottom:1px solid #ccc;padding-bottom:2px;",
        });

        const row = el("div", {
            class: "row",
            style: "display:flex;align-items:center;gap:4px;",
        });

        const chk = el("input", { type: "checkbox" });
        if (base) {
            // ダイヤ上必須停車駅 → 常に停車＆変更不可
            chk.checked  = true;
            chk.disabled = true;
        } else {
            // 任意停車駅 → 追加停車セットに含まれていればチェック
            chk.checked = extraSet.has(n);
        }

        const label = el("label", {}, [chk, " ", n]);
        row.appendChild(label);
        block.appendChild(row);
        container.appendChild(block);
    });
}


window.addEventListener("load", async () => {
	await loadData();
	init();
});
