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
	},
	config: {
		direction: "上り",
		type: "",
		dest: "",
		cars: 10,
		trainNo: "",
		endChange: false,
		second: { type: "", dest: "", cars: 10, trainNo: "" },
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
	},
};

// ==== Load datasets ====
async function loadData() {
	const [stations, types, dests, ttable] = await Promise.all([
		fetch("./data/stations.json").then((r) => r.json()),
		fetch("./data/types.json").then((r) => r.json()),
		fetch("./data/destinations.json").then((r) => r.json()),
		fetch("./data/train_number_table.json").then((r) => r.json()),
	]);
	state.datasets.stations = stations;
	state.datasets.types = types;
	state.datasets.dests = dests;
	state.datasets.trainTable = ttable;
}

// ==== Speech ====
function speakOnce(key, text) {
	const now = Date.now();
	const last = state.runtime.lastSpoken[key] || 0;
	if (now - last < 30000) return; // 30秒抑止
	state.runtime.lastSpoken[key] = now;

	const utter = new SpeechSynthesisUtterance(text);
	utter.lang = "ja-JP";
	const voices = speechSynthesis.getVoices();
	const jpVoices = voices.filter((v) => v.lang.startsWith("ja"));
	if (jpVoices.length > 0) utter.voice = jpVoices[0];
	speechSynthesis.speak(utter);
}

// ==== Train number parser ====
// 対応: 「開始〜終了」範囲 && 奇数→右 / 偶数→左 行先
function parseTrainNo(trainNo) {
	const n = parseInt(String(trainNo), 10);
	if (Number.isNaN(n)) return null;
	let found = null;

	for (const row of state.datasets.trainTable) {
		const start = parseInt(row["列車番号"], 10);
		const end = parseInt(row["Unnamed: 1"], 10);
		if (!Number.isNaN(start) && !Number.isNaN(end) && n >= start && n <= end) {
			const type = row["種別"] || "";
			const destOdd = row["行先"] || "";
			const destEven = row["Unnamed: 4"] || "";
			const dest = n % 2 === 0 ? destEven : destOdd;
			found = { type, dest };
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
function screenSettings() {
	const root = el("div", { class: "screen active", id: "screen-settings" });
	const c = el("div", { class: "container" });

	const trainNo = el("input", {
		type: "text",
		placeholder: "4桁の列車番号",
		id: "trainNo",
	});
	const btnSearch = el("button", { class: "btn" }, "検索");
	btnSearch.onclick = () => {
		const res = parseTrainNo(trainNo.value.trim());
		if (res) {
			typeSel.value = res.type;
			destSel.value = res.dest;
		} else {
			alert("列番表に該当がありません。手動で選択してください。");
		}
	};

	const dirSel = el("select", { id: "direction" }, [
		el("option", { value: "上り" }, "上り"),
		el("option", { value: "下り" }, "下り"),
	]);

	const typeSel = el("select", { id: "type" });
	state.datasets.types.forEach((t) => {
		typeSel.appendChild(el("option", { value: t }, t));
	});

	const destSel = el("select", { id: "dest" });
	state.datasets.dests.forEach((d) => {
		destSel.appendChild(el("option", { value: d }, d));
	});

	const carsIn = el("input", {
		type: "number",
		id: "cars",
		min: "1",
		max: "12",
		value: "10",
	});

	const endChange = el("input", { type: "checkbox", id: "endChange" });
	const secondWrap = el("div", { id: "secondConfig", style: "display:none;" });
	endChange.onchange = () => {
		secondWrap.style.display = endChange.checked ? "block" : "none";
	};

	const trainNo2 = el("input", { type: "text" });
	const typeSel2 = el("select");
	state.datasets.types.forEach((t) => {
		typeSel2.appendChild(el("option", { value: t }, t));
	});
	const destSel2 = el("select");
	state.datasets.dests.forEach((d) => {
		destSel2.appendChild(el("option", { value: d }, d));
	});
	const carsIn2 = el("input", {
		type: "number",
		min: "1",
		max: "12",
		value: "10",
	});

	secondWrap.append(
		el("div", { class: "row" }, [el("label", {}, "列番(後)"), trainNo2]),

		el("div", { class: "grid2" }, [
			el("div", {}, [el("label", {}, "種別(後)"), typeSel2]),
			el("div", {}, [el("label", {}, "行先(後)"), destSel2]),
		]),

		el("div", { class: "row" }, [el("label", {}, "両数(後)"), carsIn2]),
	);

	const execBtn = el("button", { class: "btn" }, "実行");
	execBtn.onclick = () => {
		state.config.trainNo = trainNo.value.trim();
		state.config.direction = dirSel.value;
		state.config.type = typeSel.value;
		state.config.dest = destSel.value;
		state.config.cars = parseInt(carsIn.value, 10);
		state.config.endChange = endChange.checked;
		if (endChange.checked) {
			state.config.second.trainNo = trainNo2.value.trim();
			state.config.second.type = typeSel2.value;
			state.config.second.dest = destSel2.value;
			state.config.second.cars = parseInt(carsIn2.value, 10);
		}
		document.getElementById("screen-settings").classList.remove("active");
		document.getElementById("screen-start").classList.add("active");
	};

	c.append(
		el("div", { class: "row" }, [
			el("label", {}, "列車番号"),
			trainNo,
			btnSearch,
		]),
		el("div", { class: "grid2" }, [
			el("div", [el("label", {}, "上り/下り"), dirSel]),
			el("div", [el("label", {}, "両数"), carsIn]),
		]),
		el("div", { class: "grid2" }, [
			el("div", [el("label", {}, "種別"), typeSel]),
			el("div", [el("label", {}, "行先"), destSel]),
		]),
		el("div", { class: "row" }, [endChange, el("span", {}, " 終点で列番変更")]),
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
	if (!show) return;
	const c =
		cars === 10
			? "d10"
			: cars === 8
				? "d8"
				: cars === 6
					? "d6"
					: cars === 4
						? "d4"
						: cars === 7
							? "d7"
							: "d10";
	const diamond = el("div", { class: `diamond ${c}` }, [
		el("span", {}, cars === 7 ? "特" : `${cars}両`),
	]);
	elm.appendChild(diamond);
}

function screenGuidance() {
	const root = el("div", { class: "screen", id: "screen-guidance" });
	const band1 = el("div", { class: "band band1" });
	const band2 = el("div", { class: "band band2" }, [
		el("div", { class: "notes", id: "notes" }, ""),
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
			]),
		]),
	]);
	root.appendChild(modal);

	root._band1 = band1;
	root._badgeType = band3.querySelector("#badgeType");
	root._cellNo = band4.querySelector("#cellNo");
	root._cellDest = band4.querySelector("#cellDest");
	root._clock = band5.querySelector("#clock");

	band5.querySelector("#btnMenu").onclick = () => modal.classList.add("active");
	modal.onclick = (e) => {
		if (e.target.id === "menuModal") modal.classList.remove("active");
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

	return root;
}

function openList(title, list, onPick) {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");
	const wrap = el("div", {}, [
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
	]);
	panel.appendChild(wrap);
	modal.addEventListener("transitionend", () => panel.removeChild(wrap), {
		once: true,
	});
}

function openStopList() {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");
	const names = Object.keys(state.datasets.stations);
	const sel = new Set(names.filter((n) => !state.runtime.passStations.has(n)));

	const wrap = el("div", {}, [
		el("hr", { class: "sep" }),
		el("h3", {}, "臨時停車・通過"),
	]);
	const box = el("div", { style: "max-height:50vh;overflow:auto;" });
	names.forEach((n) => {
		const chk = el("input", { type: "checkbox", checked: sel.has(n) });
		const row = el("label", {}, [chk, " ", n]);
		box.appendChild(row);
	});
	const done = el("button", { class: "btn" }, "決定");
	done.onclick = () => {
		const checks = box.querySelectorAll("input[type=checkbox]");
		const newSel = new Set();
		checks.forEach((c, i) => {
			if (c.checked) newSel.add(names[i]);
		});
		state.runtime.passStations = new Set(names.filter((n) => !newSel.has(n)));
		modal.classList.remove("active");
	};
	wrap.append(box, done);
	panel.appendChild(wrap);
	modal.addEventListener("transitionend", () => panel.removeChild(wrap), {
		once: true,
	});
}

function openPlatformList() {
	// 画面仕様は stopList と同じ構成で実用上は動作可
}

function openTrainChange() {
	const modal = document.getElementById("menuModal");
	const panel = modal.querySelector(".panel");
	const names = Object.keys(state.datasets.stations);
	const wrap = el("div", {}, [
		el("hr", { class: "sep" }),
		el("h3", {}, "列番変更"),
	]);
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
	modal.addEventListener("transitionend", () => panel.removeChild(wrap), {
		once: true,
	});
}

let clockTimer = null,
	gpsWatchId = null;

function startGuidance() {
	state.runtime.started = true;
	renderGuidance();
	clockTimer = setInterval(() => {
		const d = new Date();
		document.getElementById("screen-guidance")._clock.textContent =
			`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
	}, 200);

	if (navigator.geolocation) {
		gpsWatchId = navigator.geolocation.watchPosition(onPos, console.warn, {
			enableHighAccuracy: true,
			maximumAge: 1000,
			timeout: 10000,
		});
	} else alert("GPS使用不可");
}

function stopGuidance() {
	if (clockTimer) clearInterval(clockTimer);
	if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
}

function renderGuidance() {
	const root = document.getElementById("screen-guidance");
	root._badgeType.className = "badge " + typeClass(state.config.type);
	root._badgeType.textContent = state.config.type;
	root._cellNo.textContent = state.config.trainNo;
	root._cellDest.textContent = state.config.dest;
}

function nearestStation(lat, lng) {
	let best = null,
		bestD = 1e12;
	for (const [name, info] of Object.entries(state.datasets.stations)) {
		if (info.lat == null || info.lng == null) continue;
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
	const t = state.config.type;
	const d = state.runtime.speedKmh;

	// 特記事項
	otherSpeaks(ns);

	const key = ns.name;

	if (!isNonPassenger(t)) {
		const isStop = !state.runtime.passStations.has(ns.name);

		if (state.runtime.lastStopStation && ns.distance > 100) {
			speakOnce(
				"leave100_" + key,
				`次は${state.runtime.lastStopStation}、停車`,
			);
			state.runtime.lastStopStation = null;
		}

		if (isStop && ns.distance <= 300) {
			speakOnce(
				"arr300_" + key,
				`まもなく${ns.name}、停車、${state.config.cars}両`,
			);
		}

		if (isStop && ns.distance <= 120) {
			if (
				state.config.cars === 8 &&
				(state.config.direction === "上り" ? ns.up8pos : ns.down8pos)
			) {
				speakOnce(
					"arr120_" + key,
					`停車、8両、${state.config.direction === "上り" ? ns.up8pos : ns.down8pos}あわせ`,
				);
			} else if (state.config.cars === 10) {
				speakOnce("arr120_" + key, `停車、10両`);
			} else {
				speakOnce(
					"arr120_" + key,
					`停車、${state.config.cars}両、停止位置注意`,
				);
			}
			if (ns.distance <= 50 && isStop) state.runtime.lastStopStation = ns.name;
		}

		if (!isStop && ns.distance <= 200 && d <= 45) {
			speakOnce("pass200_" + key, `種別${t}、通過`);
		}
		if (!isStop && ns.distance <= 120 && d <= 30) {
			speakOnce("pass120_" + key, `種別${t}、通過、速度注意`);
		}
	} else {
		if (ns.distance <= 200 && d <= 45)
			speakOnce("nonp200_" + key, `種別回送、ていつう確認`);
		if (ns.distance <= 120 && d <= 30)
			speakOnce("nonp120_" + key, `種別回送、ドアあつかい注意`);
	}
}

function otherSpeaks(ns) {
	const h = new Date();
	const hh = h.getHours(),
		mm = h.getMinutes();
	const after1555 = hh > 15 || (hh === 15 && mm >= 55);
	const before0100 = hh < 1;
	const timeOK = after1555 || before0100;

	if (
		state.config.direction === "上り" &&
		state.config.dest === "小竹向原" &&
		ns.name === "練馬" &&
		ns.distance > 100
	) {
		speakOnce("rule-nerima", "搭載かばん、確認");
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
