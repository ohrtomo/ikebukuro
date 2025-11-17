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
	},
	config: {
		direction: "上り",
		type: "",
		dest: "",
		cars: 10,
		trainNo: "",
		endChange: false,
		second: { type: "", dest: "", cars: 10, trainNo: "" },

        // ★ 音量（0.0〜1.0）: 初期値は最大
        voiceVolume: 1.0,

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
		lastStopDistance: null,   // ★ 直前の「最後に停車した駅」からの距離
		// ★ 300m/120m判定用：前回の最近傍駅とその距離
		prevStationName: null,
		prevStationDistance: null,
		prevDistances: {},        // ★ 駅ごとの「前回距離」（300m判定用）
		routeLocked: false,      // ルートを確定したかどうか
		routeLine: null,         // "main" / "yuraku" / "toshima" / "sayama"
		
	},
};

// ==== Load datasets ====
async function loadData() {
	const [stations, types, dests, ttable] = await Promise.all([
		fetch("./data/stations.json").then((r) => r.json()),
		fetch("./data/types.json").then((r) => r.json()),
		fetch("./data/destinations.json").then((r) => r.json()),
		fetch("./data/train_number_table.json").then((r) => r.json()),
		fetch("./data/car_icons.json").then((r) => r.json()),
	]);
	state.datasets.stations = stations;
	state.datasets.types = types;
	state.datasets.dests = dests;
	state.datasets.trainTable = ttable;
	state.datasets.carIcons   = carIcons || {};   
}

// ==== Speech ====
function speakOnce(key, text) {
    const now = Date.now();
    const last = state.runtime.lastSpoken[key] || 0;
    if (now - last < 30000) return; // 30秒抑止
    state.runtime.lastSpoken[key] = now;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";

    // ★ 音量反映（0.0〜1.0）
    const vol = state.config.voiceVolume;
    utter.volume = typeof vol === "number" ? Math.min(Math.max(vol, 0), 1) : 1.0;

    speechSynthesis.speak(utter);

    // ★ 読み上げ内容を「音声用」表示欄に表示（次の読み上げまで残す）
    const root = document.getElementById("screen-guidance");
    if (root && root._speechText) {
        root._speechText.textContent = text;
    }
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
		const end = parseInt(row["Unnamed: 1"], 10);
		if (!Number.isNaN(start) && !Number.isNaN(end) && n >= start && n <= end) {
			const type = row["種別"] || "";

			// 左側: 行先 / 右側: Unnamed: 4
			const destLeft = row["行先"] || "";
			const destRight = row["Unnamed: 4"] || "";

			// 偶数→左側（上り系） / 奇数→右側（下り系）
			const dest = n % 2 === 0 ? destLeft : destRight;

			// 偶数→上り / 奇数→下り
			const direction = n % 2 === 0 ? "上り" : "下り";

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

// ==== Screens ====
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

	// ---- 終点で列番変更 ON/OFF ----
	const endChange = el("input", { type: "checkbox", id: "endChange" });
	const secondWrap = el("div", { id: "secondConfig", style: "display:none;" });
	endChange.onchange = () => {
		secondWrap.style.display = endChange.checked ? "block" : "none";
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
    // --- ★ 必須チェック ここまで ---

		// 前半設定
		state.config.trainNo = trainNo.value.trim();
		state.config.direction = selectedDir; // 方向はボタンで選んだ値
		state.config.type = typeSel.value;
		state.config.dest = destSel.value;
		state.config.cars = selectedCars; // 両数（ボタン）

		// 終点で列番変更（後半設定）
		state.config.endChange = endChange.checked;
		if (endChange.checked) {
			state.config.second.trainNo = trainNo2.value.trim();
			state.config.second.type = typeSel2.value;
			state.config.second.dest = destSel2.value;
			// 後半の両数は前半と同じに固定（変更不可）
			state.config.second.cars = state.config.cars;
		}

		document.getElementById("screen-settings").classList.remove("active");
		document.getElementById("screen-start").classList.add("active");
	};

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
		el("div", { class: "row endchange-row" }, [endChange, el("span", {}, " 終点で列番変更")]),
		secondWrap,
		execBtn,
	);

	root.appendChild(c);
	return root;
}

function screenStart() {
	const root = el("div", { class: "screen", id: "screen-start" });
	root.append(
		el("div", { class: "centered" }, [
			el("button", { class: "btn", id: "btn-begin" }, "開始"),
			el("button", { class: "btn secondary", id: "btn-cancel" }, "中止"),
		]),
	);
	root.onclick = (e) => {
		if (e.target.id === "btn-begin") {
			// ダイヤ上の基本停車駅から通過駅リストを構築
			buildPassStationList();

			// ★案内開始の音声
			speakOnce("start_guidance", "案内を開始します");

			document.getElementById("screen-start").classList.remove("active");
			document.getElementById("screen-guidance").classList.add("active");
			startGuidance();
		} else if (e.target.id === "btn-cancel") {
			document.getElementById("screen-start").classList.remove("active");
			document.getElementById("screen-settings").classList.add("active");
		}
	};
	return root;
}

function typeClass(t) {
	if (t === "特急") return "j-tokkyu";
	if (t === "SトレA" || t === "SトレB下" || t === "SトレB上") return "j-storea";
	if (t === "快速急行" || t === "地下快急") return "j-kaisokukyuko";
	if (t === "急行") return "j-kyuko";
	if (t === "通勤急行") return "j-tsukin_kyuko";
	if (t === "快速") return "j-kaisoku";
	if (t === "準急") return "j-junkyu";
	if (t === "通勤準急") return "j-tsukin_junkyu";
	if (t === "区間準急") return "j-kukan_junkyu";
	if (t === "各停") return "j-kakutei";
	if (/回送|試運転/.test(t)) return "j-kaiso";
	if (/臨時/.test(t)) return "j-rinji-a";
	return "j-kakutei";
}

function band1RenderCars(elm, show, cars) {
  elm.innerHTML = "";

  // 非表示時は visibility だけ切り替え
  if (!show) {
    elm.style.visibility = "hidden";
    return;
  }
  elm.style.visibility = "visible";

  const icons = state.datasets.carIcons || {};
  const info =
    icons[String(cars)]         // 10, 8, 7, … に一致
    || icons.default            // なければデフォルト
    || null;

  // アイコン情報がなければ文字だけ出しておく
  if (!info || !info.src) {
    const fallback = el(
      "div",
      { class: "cars-wrapper" },
      `${cars}両`
    );
    elm.appendChild(fallback);
    return;
  }

  const img = el("img", {
    src: info.src,
    alt: info.alt || `${cars}両`,
    class: "cars-icon",
  });

  const wrapper = el("div", { class: "cars-wrapper" }, img);
  elm.appendChild(wrapper);
}

function screenGuidance() {
    const root = el("div", { class: "screen", id: "screen-guidance" });
    const band1 = el("div", { class: "band band1" });
    const band2 = el("div", { class: "band band2" }, [
        // ★ GPS 状態表示用
        el("div", { class: "notes", id: "gpsStatus" }, ""),
        // ★ 音声案内テキスト表示用
        el("div", { class: "notes speech", id: "speechText" }, ""),
    ]);
	const band3 = el("div", { class: "band band3" }, [
		el("div", { class: "badge", id: "badgeType" }, ""),
	]);
	const band4 = el("div", { class: "band band4" }, [
		el("div", { class: "cell", id: "cellNo" }, "----"),
		el("div", { class: "cell", id: "cellDest" }, "----"),
	]);
	const band5 = el("div", { class: "band band5" }, [
		el("div", { class: "menu-btn", id: "btnMenu" }, "≡"),
		el("div", { class: "clock", id: "clock" }, "00:00:00"),
	]);

	root.append(band1, band2, band3, band4, band5);

	// Menu modal
	const modal = el("div", { class: "modal", id: "menuModal" }, [
		el("div", { class: "panel" }, [
			el("h3", {}, "メニュー"),
			el("div", { class: "list" }, [
				el("button", { class: "btn secondary", id: "m-end" }, "案内終了"),
				el(
					"button",
					{ class: "btn secondary", id: "m-stop" },
					"臨時停車・通過",
				),
				el(
					"button",
					{ class: "btn secondary", id: "m-platform" },
					"着発線変更",
				),
				el("button", { class: "btn secondary", id: "m-dest" }, "行先変更"),
				el("button", { class: "btn secondary", id: "m-type" }, "種別変更"),
				el("button", { class: "btn secondary", id: "m-train" }, "列番変更"),
				el("button", { class: "btn secondary", id: "m-volume" }, "音量設定・テスト"),// 音量設定
			]),
		]),
	]);
	root.appendChild(modal);

    const panel = modal.querySelector(".panel");

    root._band1      = band1;
    root._gpsStatus  = band2.querySelector("#gpsStatus");   // ★ GPS 用
    root._speechText = band2.querySelector("#speechText");  // ★ 音声用
    root._badgeType  = band3.querySelector("#badgeType");
	root._cellNo = band4.querySelector("#cellNo");
	root._cellDest = band4.querySelector("#cellDest");
	root._clock = band5.querySelector("#clock");

	// メニューボタン：開くたびにサブ画面（menu-subpanel）をリセット
	band5.querySelector("#btnMenu").onclick = () => {
		modal.classList.add("active");
		panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());
	};

	// 背景クリックでモーダル閉じる＋サブ画面消去
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
			state.config.type = v;
		});
	modal.querySelector("#m-stop").onclick = () => openStopList();
	modal.querySelector("#m-platform").onclick = () => openPlatformList();
	modal.querySelector("#m-train").onclick = () => openTrainChange();
	modal.querySelector("#m-volume").onclick = () => openVolumePanel();

	return root;
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

// 臨時停車・通過
function openStopList() {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");

	const names = Object.keys(state.datasets.stations);
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
			el("h3", {}, "臨時停車・通過"),
		],
	);

	const box = el("div", { style: "max-height:50vh;overflow:auto;" });

	names.forEach((n) => {
		// ★ 現在の設定：passStations に入っていれば通過、入っていなければ停車
		const isCurrentlyPass = state.runtime.passStations.has(n);
		const isStopNow = !isCurrentlyPass;

		const chk = el("input", { type: "checkbox" });
		chk.checked = isStopNow; // チェック = 停車扱い

		const row = el("label", {}, [chk, " ", n]);
		box.appendChild(row);
	});

	const done = el("button", { class: "btn" }, "決定");
	done.onclick = () => {
		const checks = box.querySelectorAll("input[type=checkbox]");
		const newStopSet = new Set();

		checks.forEach((c, i) => {
			if (c.checked) newStopSet.add(names[i]); // チェック = 停車駅
		});

		// 通過駅 = 全駅 - 停車駅
		state.runtime.passStations = new Set(
			names.filter((n) => !newStopSet.has(n)),
		);

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

// 着発線変更（枠だけ）
function openPlatformList() {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");
	const kind = "platform";

	const existing = panel.querySelector(
		`.menu-subpanel[data-kind="${kind}"]`,
	);
	if (existing) {
		existing.remove();
		return;
	}

	panel.querySelectorAll(".menu-subpanel").forEach((el) => el.remove());

	const wrap = el(
		"div",
		{ class: "menu-subpanel", "data-kind": kind },
		[
			el("hr", { class: "sep" }),
			el("h3", {}, "着発線変更"),
			// 必要があればここに実装を追加
		],
	);

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
	if (MAIN_LINE_ORDER.includes(name)) return "main";
	if (YURAKU_LINE_ORDER.includes(name)) return "yuraku";
	if (TOSHIMA_LINE_ORDER.includes(name)) return "toshima";
	if (SAYAMA_LINE_ORDER.includes(name)) return "sayama";
	return null;
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

// ==== ルート確定ロジック ====
// ns: nearestStation() の結果オブジェクト
function updateRouteLock(ns) {
	if (!ns) return;

	// すでに確定済みなら何もしない
	if (state.runtime.routeLocked && state.runtime.routeLine) return;

	const dir = state.config.direction;      // "上り" / "下り"
	const destCat = getDestCategory(state.config.dest); // "main" / "yuraku" / ...

	// 1) 池袋線 下り：東長崎 を通過したら「本線」で確定
	//    → ここから先、新桜台が近づいても有楽町線は無視したい
	if (dir === "下り" && ns.name === "東長崎") {
		state.runtime.routeLocked = true;
		state.runtime.routeLine = "main";
		return;
	}

	// 2) 練馬 付近でルート確定
	if (ns.name === "練馬") {
		let line = "main";

		// 練馬から上りで有楽町線方面（小竹向原行き） → 有楽町線
		if (dir === "上り" && destCat === "yuraku") {
			line = "yuraku";
		}
		// 練馬から下りで豊島線方面（豊島園行き） → 豊島線
		else if (dir === "下り" && destCat === "toshima") {
			line = "toshima";
		}
		// それ以外 → 池袋線本線として扱う

		state.runtime.routeLocked = true;
		state.runtime.routeLine = line;
		return;
	}

	// 3) 西所沢で狭山線 or 本線を確定（お好みで）
	if (ns.name === "西所沢") {
		if (dir === "下り" && destCat === "sayama") {
			state.runtime.routeLocked = true;
			state.runtime.routeLine = "sayama";
		} else {
			state.runtime.routeLocked = true;
			state.runtime.routeLine = "main";
		}
		return;
	}
}


let clockTimer = null;
let gpsTimer = null;

function startGuidance() {
	state.runtime.routeLocked = false;
	state.runtime.routeLine = null;
	state.runtime.started = true;
	renderGuidance();

	// 時計表示
	clockTimer = setInterval(() => {
		const d = new Date();
		document.getElementById("screen-guidance")._clock.textContent =
			`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
	}, 200);

	// 1秒ごとに現在位置を取得
	if (navigator.geolocation) {
		gpsTimer = setInterval(() => {
			navigator.geolocation.getCurrentPosition(
                onPos,
                () => {
                    // ★ 位置情報が取得できない場合の表示（GPS用だけ）
                    const root = document.getElementById("screen-guidance");
                    if (root && root._gpsStatus) {
                        root._gpsStatus.textContent = "位置情報が取得できません";
                    }
                },

				{
					enableHighAccuracy: true,
					maximumAge: 0,
					timeout: 5000,
				},
			);
		}, 1000);
	} else {
		alert("GPS使用不可");
	}
}

function stopGuidance() {
	if (clockTimer) {
		clearInterval(clockTimer);
		clockTimer = null;
	}
	if (gpsTimer) {
		clearInterval(gpsTimer);
		gpsTimer = null;
	}
}

function renderGuidance() {
	const root = document.getElementById("screen-guidance");
	root._badgeType.className = "badge " + typeClass(state.config.type);
	root._badgeType.textContent = state.config.type;
	root._cellNo.textContent = state.config.trainNo;
	root._cellDest.textContent = state.config.dest;
}

function updateNotes(lat, lng, timeMs) {
    const root = document.getElementById("screen-guidance");
    if (!root || !root._gpsStatus) return;

    const d = new Date(timeMs);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");

    root._gpsStatus.textContent =
        `現在位置: ${lat.toFixed(5)}, ${lng.toFixed(5)} /  ${hh}:${mm}:${ss}`;
}

function nearestStation(lat, lng) {
	let best = null,
		bestD = 1e12;

	// ★ 確定済みルート
	const lockedLine = state.runtime.routeLine;

	for (const [name, info] of Object.entries(state.datasets.stations)) {
		if (info.lat == null || info.lng == null) continue;

		// ★ ルート確定済みなら、別路線の駅は無視
		if (lockedLine) {
			const line = getLineForStation(name); // "main" / "yuraku" / ...

			// line が判定できて、かつ確定ルートと異なる場合はスキップ
			if (line && line !== lockedLine) {
				continue;
			}
		}

		const d = haversine(lat, lng, info.lat, info.lng);
		if (d < bestD) {
			bestD = d;
			best = { name, ...info, distance: d };
		}
	}
	return best;
}

function onPos(pos) {
	const { latitude, longitude } = pos.coords;
	const now = Date.now();
	if (state.runtime.lastPosition) {
		const dt = (now - state.runtime.lastPosition.time) / 1000;
		const dist = haversine(
			state.runtime.lastPosition.lat,
			state.runtime.lastPosition.lng,
			latitude,
			longitude,
		);
		state.runtime.speedKmh = (dist / dt) * 3.6;
	}
	state.runtime.lastPosition = { lat: latitude, lng: longitude, time: now };

	updateNotes(latitude, longitude, now);

	const ns = nearestStation(latitude, longitude);
	maybeSpeak(ns);
	const show =
		ns && ns.distance <= 300 && !state.runtime.passStations.has(ns.name);
	band1RenderCars(
		document.getElementById("screen-guidance")._band1,
		show,
		state.config.cars,
	);
}

function isNonPassenger(t) {
	return /(回送|試運転|臨時)/.test(t);
}

function maybeSpeak(ns) {
	if (!ns) return;

	// ★ ここでルート確定ロジックをまわす
	updateRouteLock(ns);

	const t = state.config.type;
	const d = state.runtime.speedKmh;
	// ★ 前回の最近傍駅と距離（300mクロス判定用）
	const prevName = state.runtime.prevStationName;
	const prevDist = state.runtime.prevStationDistance;
	const prevSameDist = prevName === ns.name ? prevDist : null;

	// 特記事項
	otherSpeaks(ns);

	const key = ns.name;

	// ★ 本来のダイヤ上の停車／通過
	const baseStop = baseIsStop(ns.name);

	// ★ 現在の設定（passStations）から見た停車／通過
	const isStop = !state.runtime.passStations.has(ns.name);

	// ★本来は通過だが今は停車 = 臨時停車
	const isExtraStop = !baseStop && isStop;
	// ★本来は停車だが今は通過 = 臨時通過
	const isExtraPass = baseStop && !isStop;

	if (!isNonPassenger(t)) {
		// ===== 前駅を発車したあとの「次は○○」案内 =====
		// lastStopStation には「次に停車する駅名」が入っている前提
		if (state.runtime.lastStopStation && ns.distance > 100) {
			const nextName = state.runtime.lastStopStation;

			if (nextName) {
				const baseNextStop = baseIsStop(nextName);
				const isNextStop = !state.runtime.passStations.has(nextName);

				const isExtraStopNext = !baseNextStop && isNextStop; // 本来通過→今は停車
				const isExtraPassNext = baseNextStop && !isNextStop; // 本来停車→今は通過

				if (isNextStop) {
					// 停車する場合：「停車」 or 「臨時停車」
					const word = isExtraStopNext ? "臨時停車" : "停車";
					speakOnce("leave100_" + nextName, `次は${nextName}、${word}`);
				} else if (isExtraPassNext) {
					// 本来停車だった駅を通過する場合だけ案内
					speakOnce("leave100_" + nextName, `次は${nextName}、臨時通過`);
				}
			}

			// 一度案内したらクリア
			state.runtime.lastStopStation = null;
		}

		// ===== 300m 手前の案内 =====
		// ★ 一番最初の測位（スポーン直後）は 300m 判定を無効にする
		const isFirstMeasurement =
			state.runtime.prevStationName === null &&
			state.runtime.prevStationDistance === null;

		// 直前は 300m より外側、今回は 300m 以内に入ったときだけ案内
		const crossed300 =
			!isFirstMeasurement &&        // ★ 初回は必ず false にする
			isStop &&
			ns.distance <= 300 &&
			(prevSameDist == null || prevSameDist > 300);

		if (crossed300) {
			const stopWord = isExtraStop ? "臨時停車" : "停車";
			speakOnce(
				"arr300_" + key,
				`まもなく${ns.name}、${stopWord}、${state.config.cars}両`,
			);
		}

		// ===== 停止直前の案内（停止位置） =====
		// 速度が 5km/h 以下のときは案内しない
		if (isStop && ns.distance <= 120 && d > 5) {
			const stopWord = isExtraStop ? "臨時停車" : "停車";

			if (
				state.config.cars === 8 &&
				(state.config.direction === "上り" ? ns.up8pos : ns.down8pos)
			) {
				speakOnce(
					"arr120_" + key,
					`${stopWord}、8両、${state.config.direction === "上り" ? ns.up8pos : ns.down8pos}あわせ`,
				);
			} else if (state.config.cars === 10) {
				speakOnce("arr120_" + key, `${stopWord}、10両`);
			} else {
				speakOnce(
					"arr120_" + key,
					`${stopWord}、${state.config.cars}両、停止位置注意`,
				);
			}

			// ★ この駅に「到着」したタイミングで、
			// 　 次に停車する駅名を調べて lastStopStation に入れておく
			if (ns.distance <= 50) {
				const nextName = findNextStopStationName(ns.name);
				state.runtime.lastStopStation = nextName || null;
			}
		}

		// ===== 通過列車の案内（200m） =====
		if (!isStop && ns.distance <= 200 && d <= 45) {
			const passWord = isExtraPass ? "臨時通過" : "通過";
			speakOnce("pass200_" + key, `種別${t}、${passWord}`);
		}
		// ===== 通過列車の案内（120m） =====
		if (!isStop && ns.distance <= 120 && d <= 30) {
			const passWord = isExtraPass ? "臨時通過" : "通過";
			speakOnce("pass120_" + key, `種別${t}、${passWord}、速度注意`);
		}
	} else {
		// 回送・試運転などは従来通り
		if (ns.distance <= 200 && d <= 45)
			speakOnce("nonp200_" + key, `種別回送、ていつう確認`);
		if (ns.distance <= 120 && d <= 30)
			speakOnce("nonp120_" + key, `種別回送、ドアあつかい注意`);
	}

	// ★ この呼び出しでの距離を次回比較用に保存
	state.runtime.prevStationName = ns.name;
	state.runtime.prevStationDistance = ns.distance;
}

function otherSpeaks(ns) {
	const h = new Date();
	const hh = h.getHours(),
		mm = h.getMinutes();
	const after1555 = hh > 15 || (hh === 15 && mm >= 55);
	const before0100 = hh < 1;
	const timeOK = after1555 || before0100;

	// ★ 練馬駅 100m 内 → 外 に出た瞬間だけ発話
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

	if (
		state.config.direction === "上り" &&
		/新宿線/.test(state.config.dest) &&
		ns.name === "所沢" &&
		ns.distance <= 400
	) {
		speakOnce("rule-tokorozawa", "列車無線チャンネル切り替え");
	}
	if (
		state.config.direction === "上り" &&
		state.config.dest === "池袋" &&
		timeOK &&
		ns.name === "椎名町" &&
		ns.distance > 150
	) {
		speakOnce("rule-shiinamachi", "ドアかいひかた、確認");
	}
}

function init() {
	const app = document.getElementById("app");
	app.append(screenSettings());
	app.append(screenStart());
	app.append(screenGuidance());
}

window.addEventListener("load", async () => {
	await loadData();
	init();
});
