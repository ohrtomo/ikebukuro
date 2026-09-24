# HANDOFF.md

# 西武鉄道 乗務支援 Web アプリ — Codex 引継ぎ書

更新基準: 2026-09-20 時点  
主対象: iPad / iPadOS Safari / ホーム画面 Web アプリ  
開発方針: 既存挙動を維持しながら、必要箇所のみ段階的に改修

---

# 1. この文書について

この文書は、長期間にわたり逐次開発してきた乗務支援 Web アプリを Codex へ引き継ぐための詳細仕様書である。

必ず併読すること:

- `AGENTS.md`
- `MUST_FOLLOW.md`

この文書には:

- 現行仕様
- データ構成
- UI 構成
- GPS / ルート判定
- 音声案内
- API 利用
- 途中駅列情変更
- 地下モード
- 手動設定
- iPadOS 対策
- 採用済み変更
- 保留事項
- 旧仕様との差分
- 既知リスク
- テスト観点

を記載する。

---

# 2. プロジェクトの目的

iPad を携行する鉄道乗務員が、GPS・列車情報・ダイヤ情報をもとに次の動作を確認できるよう支援する。

主要目的:

- 駅接近前に必要動作を音声で知らせる
- 次停車駅を確認する
- 停車 / 通過を誤らないよう補助する
- 両数・停止位置を確認する
- 着発線を確認する
- 列番・種別・行先変更を追従する
- 臨時停車 / 臨時通過を反映する
- 地下区間でも可能な情報を維持する
- ダイヤ乱れ時に手動変更できる
- iPad で長時間安定して動作する

このアプリは「判断を置き換える」ものではなく乗務支援であり、誤案内・案内欠落・重複案内を極力避ける設計を優先する。

---

# 3. 現行ファイル構成

想定:

```text
project/
├─ index.html
├─ app.js
├─ styles.css
├─ AGENTS.md
├─ MUST_FOLLOW.md
├─ HANDOFF.md
└─ data/
   ├─ stationdata.csv
   ├─ types.json
   ├─ destinations.json
   ├─ train_number_table.json
   ├─ car_icons.json
   ├─ platform.json
   ├─ nonpassenger_types.json
   ├─ car_icons/
   │  └─ ...
   └─ voice/
      └─ *.mp3
```

過去版の:

- `stations.json`
- `stationID.json`
- `station.csv`

は `stationdata.csv` に統合済みであり、現行ランタイムでは基本的に不要。

`destinations.json` は統合 **保留**。

---

# 4. stationdata.csv

## 4.1 役割

1 ファイルから次を生成する。

- `state.datasets.stations`
- `state.datasets.stationIds`
- `state.datasets.stationIdMap`
- `state.datasets.navSpots`

## 4.2 メタ列

現行:

```text
種類
名称
緯度
経度
isStopover
down8pos
up8pos
所属路線1
所属路線2
所属路線3
駅ID
```

上記以外の列は停車パターンとして扱う。

## 4.3 真偽値

次を true として扱う実装:

- `1`
- `true`
- `TRUE`
- `True`
- `○`
- `◯`
- `〇`

## 4.4 文字コード

`fetchCsvText()` は:

1. UTF-8
2. 失敗した場合 Shift-JIS

の順でデコードする。

Excel 保存の CP932 / Shift-JIS CSV への対応を壊さない。

---

# 5. その他データ

## types.json
種別一覧。

## destinations.json
行先一覧。

現在も独立ファイル。
stationdata.csv への統合は見送り中。

## train_number_table.json
列車番号から:

- 種別
- 行先
- 方向

を判定。

原則:

- 偶数 = 上り
- 奇数 = 下り

## nonpassenger_types.json
回送 / 臨時 / 試運転の細分類。

例:

- 回送A
- 回送B
- 臨時A

等。

`types.json` に存在する正式名称へ解決する。

## platform.json
平日 / 土休日 → 駅 → 番線 → 列車番号配列。

手動着発線変更がある場合は手動値を優先。

## car_icons.json / data/car_icons/
両数アイコン。

## data/voice/
録音音声 MP3。

---

# 6. 列車番号・種別・行先

## 6.1 parseTrainNo()

`train_number_table.json` を走査。

列番:

- 数値化
- 範囲に該当する行を検索
- 偶数 / 奇数で左右の行先を選択
- 方向を決定

原則:

```text
偶数 = 上り
奇数 = 下り
```

## 6.2 回送・臨時・試運転

種別に:

- 回送
- 臨時
- 試運転

が含まれる場合、`nonpassenger_types.json` から細分類を取得。

## 6.3 種別正規化

`normalizeTypeName()` で旧 SトレB表記を統一。

現行では:

- `SトレB上`
- `SトレB下`

を `SトレB` に正規化する。

旧表記を再び UI / 判定へ拡散させない。

---

# 7. 設定画面

入力:

- 列車番号
- 上り / 下り
- 種別
- 行先
- 両数
- 運転日
- 途中駅で列情変更

列番検索で:

- 種別
- 行先
- 方向

を自動反映できる。

## 7.1 両数

主な選択肢:

- 10
- 8
- 7
- 6
- 4
- 2

後半列車の両数は前半から引き継ぎ、後半で別入力しない現行仕様。

## 7.2 運転日

- 平日
- 土休日

日付から自動判定。
年末年始特例もコードに存在。

---

# 8. 設定画面「参照」

## 8.1 モード

- 上り
- 下り
- 地下

## 8.2 駅選択

上り / 下り:

- GPS を取得
- 現在の route lock を使わず、全駅から単純最寄り駅を取得

地下:

- GPS に関係なく `小竹向原`

## 8.3 発車一覧 API

```text
https://train.seibuapp.jp/trainfo-api/ti/v1.0/stations/{stationId}/departures
```

## 8.4 一覧生成

API のキー揺れに対応。

方向:

- up / 上り
- down / 下り

列番を取得。

発車時刻を `HH:MM:SS` に正規化。

種別:

**train_number_table.json を優先**

行先:

**API 側を使用**

同一列車候補を重複排除。

現在時刻からの発車順にソート。

最大 20 件。

この仕様は意図的。
「API に種別もあるから全部 API に寄せる」変更をしない。

---

# 9. 画面遷移

大まかな流れ:

```text
設定画面
  ↓
必要に応じて追加停車駅設定
  ↓
開始画面
  ↓
案内開始
  ↓
案内画面
```

案内終了後:

```text
案内画面
  ↓
設定画面
```

---

# 10. 案内画面 UI

## 10.1 左側 BAND

### BAND1
左:

- 両数アイコン

右:

- 種別
- 縦書きバッジ

### BAND2
次停車駅等の大型表示。

`次は ○○ ①` のように:

- 次は
- 駅名
- 番線

を表示。

長い駅名はフォントを自動縮小。

地下モード中は消す。

### BAND3
- 列番
- 行先

旧駅間表示欄の要素は一部残っているが、現 UI では主に右側ナビを使う。

### BAND4
発車時刻。

### BAND5
- メニュー
- 音声停止

### BAND6
- 時計
- 遅延
- GPS 状態

### BAND7
空白 / 将来拡張用。

---

# 11. 右側ナビゲーション

画面右側約 1/4。

目的:

- 地図を表示せず、線路上で現在位置と前後関係を把握する

要素:

- 縦線路
- 赤丸現在位置
- 前駅
- 次駅
- 現在駅表示
- `stationdata.csv` 由来のスポット

スポット:

- 駅
- 踏切
- 信号
- 橋梁
- トンネル
- 警戒地点等

現行表示範囲:

**現在位置から半径 600m**

過去に「通過済みスポットが残る」問題が課題として挙がったことがある。
この領域を変更するときは、進行方向と通過判定を確認する。

---

# 12. GPS

## 12.1 API

`navigator.geolocation.watchPosition()`

## 12.2 設定

```text
enableHighAccuracy: true
maximumAge: 3000 ms
timeout: 10000 ms
```

## 12.3 精度フィルタ

`accuracy > 200m`

は破棄。

## 12.4 鮮度フィルタ

`pos.timestamp` を使用。

取得から:

**10 秒超**

の GPS データは破棄。

過去資料に 5 秒という旧値がある場合があるが、**現行コードは 10 秒**。

## 12.5 距離

駅中心座標に対してハバースイン距離。

---

# 13. ルート

## 13.1 池袋線本線

物理順:

```text
池袋
椎名町
東長崎
江古田
桜台
練馬
中村橋
富士見台
練馬高野台
石神井公園
大泉学園
保谷
ひばりヶ丘
東久留米
清瀬
秋津
所沢
西所沢
小手指
狭山ヶ丘
武蔵藤沢
稲荷山公園
入間市
仏子
元加治
飯能
東飯能
武蔵丘
高麗
武蔵横手
東吾野
吾野
西吾野
正丸
正丸トンネル
芦ヶ久保
横瀬
西武秩父
```

## 13.2 有楽町線

コード上の配列:

```text
小竹向原
新桜台
練馬
```

方向判定との関係があるため、配列順を勝手に並べ直さない。

## 13.3 豊島線

```text
練馬
豊島園
```

## 13.4 狭山線

```text
西所沢
下山口
西武球場前
```

---

# 14. 行先カテゴリ

## 有楽町線
- 小竹向原

## 豊島線
- 豊島園

## 狭山線
- 西武球場前
- 下山口

## 新宿線直通
- 新宿線直通

その他は原則 main。

---

# 15. 分岐

## 練馬

上り + 小竹向原:

```text
練馬 → 新桜台 → 小竹向原
```

有楽町線へ。

下り + 豊島園:

```text
練馬 → 豊島園
```

豊島線へ。

その他:

池袋線本線。

## 西所沢

下り + 下山口 / 西武球場前:

狭山線へ。

その他:

池袋線本線。

## 新宿線直通

上りで所沢到達後、所沢より池袋側は案内しない。

ただし所沢手前からの:

```text
次は所沢...
```

までは通常案内。

---

# 16. route lock

`state.runtime.routeLine`

例:

- main
- yuraku
- toshima
- sayama

`stationBelongsToLockedLine()` で誤った近隣路線駅を拾いにくくしている。

共通駅は例外扱い。

例:

- 練馬
- 西所沢
- 小竹向原

単純最寄り駅ロジックへ置き換えると分岐付近で誤判定しやすい。

---

# 17. 停車 / 通過判定

基本停車:

種別ごとの停車パターン。

現在状態:

`state.runtime.passStations`

に入っている駅 = 通過。

そのため:

```text
isStop = !passStations.has(stationName)
```

で判定。

### 臨時停車

本来通過 + 現在停車。

### 臨時通過

本来停車 + 現在通過。

---

# 18. 手動設定

メニュー「臨時停車・通過」から:

- 臨時停車
- 臨時通過
- 着発線変更

を変更。

## 18.1 列車単位の保存

案内終了時:

- passStations
- manualPlatforms
- platformChanges

をスナップショット。

## 18.2 復元条件

次回設定した列車番号が:

**直前と完全一致**

した場合のみ復元。

別列車には持ち越さない。

この条件はユーザー指定。

---

# 19. 着発線

## 標準値

`platform.json`

から列車番号で検索。

## 手動値

`state.runtime.manualPlatforms`

があれば優先。

## 着発線変更判定

手動値と標準値が異なる場合:

`着発線変更`

扱い。

次駅案内 / 400m 案内へ文言追加。

---

# 20. 8両停止位置

基本:

- 上り → `up8pos`
- 下り → `down8pos`

`stationdata.csv` 由来。

### 清瀬特例

上り 8 両:

通常値にかかわらず、実効番線が 1 番線なら:

```text
奥
```

を返す。

手動着発線変更も `getEffectivePlatformForStation()` 経由で反映。

---

# 21. 次駅案内 — 190m

停車駅を発車して:

```text
前回距離 <= 190m
現在距離 > 190m
```

となった瞬間に発報。

次停車駅が未確定なら再計算。

通常:

```text
次は{駅名}、{番線}番、停車
```

番線なし:

```text
次は{駅名}、停車
```

臨時停車:

```text
次は{駅名}、{番線}番、臨時停車
```

着発線変更あり:

末尾に:

```text
、着発線変更
```

を追加。

次駅が臨時通過の場合:

```text
次は{駅名}、臨時通過
```

BAND2 の大型次駅表示もここで更新。

---

# 22. 400m 停車案内

外側から 400m 以内へ入った瞬間。

通常:

```text
{駅名}、停車、{両数}両
```

臨時停車:

```text
{駅名}、臨時停車、{両数}両
```

着発線変更あり:

```text
、着発線変更
```

を付加。

回送 / 試運転 / 臨時:

直後に:

```text
ドア扱い注意
```

---

# 23. 200m 停止案内

外側から 200m 以内へ入った瞬間。

**速度条件は現在撤廃済み。**

## 8両 + 停止位置あり

```text
停車、8両、手前
停車、8両、中央
停車、8両、奥
```

臨時停車の場合は先頭を `臨時停車`。

## 10両

```text
停車、10両
```

## その他

```text
停車、{両数}両、停止位置注意
```

回送 / 試運転 / 臨時:

さらに:

```text
ドア扱い注意
```

---

# 24. Sトレイン特例

`isSTrain()`:

- SトレA
- SトレB系

## ホームドア「S」確認

対象駅:

- 練馬
- 石神井公園
- 保谷
- 所沢

200m 到着案内後:

```text
ホームドア「S」確認
```

## 練馬運転停車

対象:

- SトレA
- 上り SトレB

練馬到着時:

```text
運転停車、ドア扱い注意
```

順序:

1. `ホームドア「S」確認`
2. `運転停車、ドア扱い注意`

---

# 25. 通過案内

停車しない駅。

## 200m

条件:

```text
distance <= 200m
speed <= 45km/h
```

通常:

```text
{種別}、通過
```

臨時通過:

```text
{種別}、臨時通過
```

## 120m

条件:

```text
distance <= 120m
speed <= 30km/h
```

通常:

```text
{種別}、通過、速度注意
```

臨時:

```text
{種別}、臨時通過、速度注意
```

---

# 26. 特別案内

## 26.1 練馬

条件:

- 上り
- 行先 = 小竹向原
- 練馬
- 100m 圏内から 100m 圏外へ出た瞬間

音声:

```text
搭載かばん、確認
```

## 26.2 所沢

条件:

- 上り
- 行先文字列に `新宿線`
- 所沢 400m 以内

音声:

```text
列車無線切り替え
```

`列車無線チャンネル切り替え` ではない。

## 26.3 椎名町

条件:

- 上り
- 池袋行
- 椎名町
- 220m 以下 → 220m 以上へ離脱

時間帯:

15:55〜翌 01:00:

```text
整列、確認
```

時間帯に関係なく:

```text
方向幕確認
```

旧 150m 仕様へ戻さない。

---

# 27. 発車時刻表示

停車すべき駅の:

**190m 以内**

でその駅の発車時刻を表示。

API:

```text
/stations/{stationId}/departures
```

対象列番・方向を照合。

駅から一度 190m 圏外へ出た後、GPS 揺れで再侵入して前駅時刻へ戻りにくくするため:

- `departureLeftStation`

等の状態を利用。

地下モードでは地下向けロジックで別途更新。

---

# 28. 遅延表示

`trains` API から現在列車番号を検索。

エンドポイント例:

```text
https://train.seibuapp.jp/trainfo-api/ti/v1.0/trains?lineId={lineId}&detail=0&adminFlg=1
```

路線 ID:

- L001 池袋線
- L002 狭山線
- L003 豊島線
- L005 有楽町線

delay > 0:

```text
遅延 XX 分
```

0:

非表示。

見つからないが API 応答あり:

```text
遅延不明
```

---

# 29. 運行情報

メニュー「運行情報」。

API:

```text
https://train.seibuapp.jp/trainfo-api/ti/v1.0/lines/all/status
```

主に:

```text
lineStatus[0].operationDetail
```

を表示。

過去実装では短時間キャッシュを持つ。

---

# 30. 地下モード

## 30.1 目的

地下区間では通常 GPS に頼れないため、通常駅案内を抑止し、trains API の `toStationName` 等を利用。

## 30.2 状態

- `undergroundMode`
- `undergroundSource`
- `undergroundLastToStationName`
- `autoUndergroundReady`

## 30.3 開始

### 下り
開始画面「地下起動」。

有楽町線 route lock。

初期発車時刻:

```text
小竹向原
```

### 上り
小竹向原行で練馬 200m 到着時:

```text
autoUndergroundReady = true
```

その後 trains API の `toStationName` が:

- 新桜台
- 小竹向原

になった場合:

自動で地下モード。

初期発車時刻:

```text
新桜台
```

## 30.4 地下中

- BAND2 次駅大型表示を消す
- 通常 GPS 音声を抑止
- 駅間表示を消す
- routeLine = yuraku

## 30.5 上り地下特別

`toStationName` が小竹向原へ変化:

```text
搭載かばん、確認
```

さらに上り SトレA / SトレB:

```text
運転停車、ドア扱い注意
```

## 30.6 下り地下終了

GPS で:

- 下り
- 地下モード
- 最近傍 = 練馬
- 約 210m 以内

になったら:

```text
exitUndergroundMode("main", { forceStationName: "練馬" })
```

地点リセット相当の再初期化を行う。

---

# 31. 途中駅で列情変更

## 31.1 設定

前半:

- trainNo
- type
- dest
- cars

後半:

- trainNo
- type
- dest
- changeStation

cars は前半を継承。

## 31.2 方向チェック

変更前後の列番は:

**偶奇一致**

が必要。

つまり方向一致。

## 31.3 ランタイム

- `midChangePending`
- `midChangeApplied`
- `midChangeArrivalHandled`
- `midChangeConfirmTimer`
- `midChangeTriggerStation`

## 31.4 切替タイミング

変更駅までの間に通過駅がある場合:

**変更駅に最も近い通過駅を 190m 離脱したとき**

論理的に後半列車へ切替。

間に通過駅がない場合:

変更駅へ向けて発車した駅で即切替。

## 31.5 切替内容

後半設定で上書き:

- trainNo
- type
- dest
- cars

回送等の追加停車駅セットも後半用へ切替。

`buildPassStationList()` 再実行。

表示再描画。

音声:

```text
列情変更
方向幕確認
```

## 31.6 変更駅到着

200m 到着判定時:

表示を後半列車へ更新。

その **20秒後**:

```text
列情確認
```

過去に 15 秒という案があったが、現行コードは 20 秒。

---

# 32. 回送・試運転・臨時

`isNonPassenger()`:

```text
回送
試運転
臨時
```

を含む種別。

通常停車パターンに加え、追加停車駅を設定できる。

前半 / 後半列車用に:

- `nonPassengerExtraStops`
- `nonPassengerExtraStopsSecond`

を分離。

回送等の案内では:

400m / 200m 到着案内後に:

```text
ドア扱い注意
```

---

# 33. 音声モード

設定:

```js
state.config.voiceMode
```

## recorded

録音 MP3。

案内文を文節へ分割。

例:

```text
次は石神井公園、3番、停車
```

↓

```text
次は
石神井公園
3番
停車
```

各文節の MP3 を順次再生。

MP3 がない文節:

その文節だけ合成音声へフォールバック。

## synthetic

MP3 を使わない。

案内文全体を 1 回の `SpeechSynthesisUtterance` で発話。

---

# 34. 録音音声ファイル

現行実装の URL:

```text
./data/voice/{encodeURIComponent(fileName)}.mp3
```

つまり基本的には:

```text
data/voice/石神井公園.mp3
data/voice/停車.mp3
data/voice/8両.mp3
```

のように、文節文字列をファイル名として使う設計。

文末句読点あり / なし候補も試す。

固定複合文節:

- 搭載かばん、確認
- 運転停車、ドア扱い注意
- 整列、確認
- ホームドア「S」確認
- ホームドア、S、確認
- 案内を開始します。
- これは音量テストです。

等は分割せず 1 ファイル扱い。

`VOICE_FILE_ALIASES` もある。

### 注意
過去の録音素材 CSV に `001_...wav` のような推奨名が存在しても、現行ランタイムの探索規則とは別。
Codex の判断で番号付きファイル名へ全面変更しない。

---

# 35. iPad 録音音声アーキテクチャ

これは現在最重要の設計判断。

## 35.1 過去

Web Audio API を使用:

- AudioContext
- Gain
- Compressor
- decodeAudioData
- AudioBufferSourceNode

利点:

- デジタル増幅可能

問題:

iPad で:

- 別アプリへ移動
- 数秒バックグラウンド
- スリープ
- 復帰

後に AudioContext が再生不能 / 無音となる。

resume / 再生成等を複数回試したが安定しなかった。

## 35.2 現在

Web Audio を録音音声経路から除外。

**1 個の HTMLAudioElement を使い回す。**

主要変数:

```text
recordedVoiceAudio
voiceRearmRequired
activeRecordedVoiceFinish
```

### configureVoiceAudioSession()

可能なら:

```text
navigator.audioSession.type = transient-solo
```

失敗時:

```text
playback
```

### getRecordedVoiceAudio()

- `<audio>` を 1 個だけ生成
- `preload = auto`
- `playsInline`
- 非表示
- body へ追加
- 以後再利用

### stopRecordedVoicePlayback()

- pause
- 再生待機 Promise を即時 resolve

バックグラウンド移行時のキュー詰まり防止に重要。

---

# 36. iPad バックグラウンド復帰

## background

`visibilitychange` で hidden:

- 古い音声キューの世代を無効化
- `stopRecordedVoicePlayback("cancelled", true)`
- `speechSynthesis.cancel()`
- `voiceRearmRequired = true`

古い音声案内をバックグラウンド中に継続しない。
`HTMLAudioElement` 自体は維持し、古い `src` とデコーダ状態だけを破棄する。

## foreground

案内中:

- Wake Lock 再取得
- 250ms 後に persistent `HTMLAudioElement` で自動再開を試行
- 失敗時は 1200ms 後にもう 1 回だけ再試行
- `pageshow` / `focus` / `navigator.audioSession.statechange` からの復帰も同じ処理へ集約
- 2 回とも OS に拒否された場合のみ `音声再開` ボタン表示

## 音声再開

自動再開またはユーザーのタップ直下で:

録音モード:

- Audio Session 設定
- 古い音声ソースのリセット
- `案内を開始します。` MP3 を play
- 成功したら自動復帰完了、またはボタン削除

合成モード:

- speechSynthesis cancel / resume
- `案内を開始します。` を発話
- 成功扱い後ボタン削除

自動再開はベストエフォートであり、iPadOS の autoplay 制限を回避できるとは限らない。
`play()` / `resume()` の無限反復は行わず、拒否時の1タップフォールバックを維持する。

---

# 37. 開始時音声

開始画面:

- 「開始」
- 下りの場合「地下起動」

のユーザー操作内で:

```text
configureVoiceAudioSession()
getRecordedVoiceAudio()
rearmVoiceFromUserGesture()
```

を呼ぶ。

そのため `startGuidance()` 内では従来の:

```text
speakOnce("start_guidance", ...)
```

による二重開始音声を出さない。

開始確認音:

```text
案内を開始します。
```

---

# 38. 音声キュー

`voicePlaybackQueue`

で案内を直列化。

目的:

複数案内の重なり防止。

`speakOnce()` で:

- 案内開始前抑止
- 地下モード抑止
- voiceMuted
- 開始後 10 秒
- 同一キー 30 秒

等を判定してキューへ入れる。

バックグラウンド中は新規案内を入れない。

---

# 39. 音声停止

BAND5:

```text
音声停止
```

`runtime.voiceMuted`

を使用。

キュー投入後にミュートされた場合も、再生処理側で確認する箇所がある。

この UI と状態を音声モード変更とは混同しない。

---

# 40. 音量設定・テスト

メニュー:

```text
音量設定・テスト
```

`voiceVolume`:

```text
0.0 ～ 1.0
```

テスト:

```text
これは音量テストです。
```

録音モード:

HTMLAudioElement で直接 MP3 を試す。
ボタン操作自体がユーザージェスチャーなので iPad の再生許可再取得にも利用。

合成モード:

SpeechSynthesis。

### 重要
以前の Web Audio では `VOICE_DIGITAL_BOOST` により 1.0 超の増幅を行っていた。

現行 HTMLAudioElement では:

```text
volume <= 1.0
```

なので、追加デジタル増幅はできない。

音量不足を解決する場合は:

- MP3 自体のラウドネス
- コンプレッション
- マスタリング

等を検討する。

AudioContext を音量増幅目的だけで再導入しない。

---

# 41. メニュー

現行項目:

```text
案内終了
臨時停車・通過
行先変更
種別変更
列番変更
音量設定・テスト
音声変更
地点リセット
運行情報
強制地下
とじる
```

## レイアウト

原則 2 列。

ただし:

```text
案内終了
とじる
```

は全幅。

---

# 42. 地点リセット

ルート / 現在位置状態を再推定するための機能。

地下モード終了時にも地点リセット相当処理を利用。

GPS 揺れや分岐誤判定への復旧機構でもあるため、単純削除しない。

---

# 43. Wake Lock

案内画面中:

画面消灯防止。

フォアグラウンド復帰:

案内中なら再取得。

iPadOS で取得できない場合は例外を許容し、アプリ全体を止めない。

---

# 44. 現在の既知リスク

## 44.1 iPadOS 音声

最大の既知リスク。

HTMLAudioElement 方式へ変更済みだが、実機で継続確認が必要。

テスト:

- 起動直後
- 10秒別アプリ
- 1分別アプリ
- ホーム画面
- Safari タブ移動
- 画面スリープ
- 長時間スリープ
- 復帰 → 自動音声再開
- 自動再開拒否時 → 音声再開ボタン
- 録音モード
- 合成モード
- 音量テスト

## 44.2 合成音声

SpeechSynthesis は Safari 内部状態に依存。

現行では毎回:

- cancel
- resume
- 短い待機
- speak

タイムアウト時も cancel / resume。

それでも iPadOS の制限を完全に回避できるとは限らない。

## 44.3 API

本番 API に依存。

- 項目名
- 応答形式
- CORS
- ネットワーク
- サーバ側仕様

が変わる可能性。

キー揺れ対応を削らない。

## 44.4 GPS

駅が近接する箇所、分岐、地下、低精度時は誤判定リスク。

route lock と startup location detection を維持。

---

# 45. 保留事項

## destinations.json 統合

`stationdata_with_destinations.csv` 等を検討したが:

**保留**

現状:

```text
destinations.json
```

を別読み込み。

再開はユーザー指示がある場合のみ。

---

# 46. 過去仕様からの重要な更新

古い会話・ファイルに異なる値が存在する。

Codex は以下を現行として扱う。

| 項目 | 現行 | 旧案の例 |
|---|---|---|
| GPS stale 判定 | 10秒超を破棄 | 5秒 |
| 椎名町特別案内 | 220m離脱 | 150m |
| 椎名町時間帯文言 | 整列、確認 | 別旧文言 |
| 所沢文言 | 列車無線切り替え | 列車無線チャンネル切り替え |
| 列情確認 | 変更駅到着20秒後 | 15秒 |
| 録音再生 | HTMLAudioElement | Web Audio |
| iPad復帰 | HTMLAudioElementで有限回の自動再開、拒否時のみ1タップ | AudioContext自動resume |
| 200m停止案内 | 距離のみ | 速度条件ありの旧案 |

古いバックアップのコメントを根拠に戻さない。

---

# 47. テストチェックリスト

## 47.1 構文

- [ ] `node --check app.js`
- [ ] Console error なし
- [ ] 同名関数重複なし

## 47.2 設定

- [ ] 列番入力
- [ ] 検索
- [ ] 上下方向
- [ ] 種別
- [ ] 行先
- [ ] 両数
- [ ] 運転日
- [ ] 途中駅列情変更

## 47.3 参照

- [ ] 上り
- [ ] 下り
- [ ] 地下
- [ ] GPS 最寄り駅
- [ ] 地下 = 小竹向原
- [ ] 発車時刻順
- [ ] 種別 = train number table
- [ ] 行先 = API
- [ ] 選択列番反映

## 47.4 GPS

- [ ] accuracy >200m破棄
- [ ] stale >10s破棄
- [ ] 本線
- [ ] 練馬分岐
- [ ] 西所沢分岐
- [ ] route lock
- [ ] 地点リセット

## 47.5 停車

- [ ] 400m
- [ ] 200m
- [ ] 8両停止位置
- [ ] 10両
- [ ] その他停止位置注意
- [ ] 臨時停車
- [ ] 着発線変更

## 47.6 発車後

- [ ] 190m離脱
- [ ] 次停車駅
- [ ] 番線
- [ ] BAND2表示
- [ ] 発車時刻更新

## 47.7 通過

- [ ] 200m / 45km/h
- [ ] 120m / 30km/h
- [ ] 臨時通過
- [ ] 速度注意

## 47.8 特例

- [ ] 練馬 搭載かばん
- [ ] 所沢 列車無線切り替え
- [ ] 椎名町 整列
- [ ] 椎名町 方向幕
- [ ] Sトレ ホームドアS
- [ ] Sトレ 練馬運転停車

## 47.9 地下

- [ ] 下り地下起動
- [ ] 上り自動地下切替
- [ ] 通常音声抑止
- [ ] 地下発車時刻
- [ ] 小竹向原特別音声
- [ ] 下り練馬で地上復帰

## 47.10 列情変更

- [ ] 偶奇一致チェック
- [ ] 変更駅まで通過駅あり
- [ ] 通過駅190m離脱で切替
- [ ] 通過駅なしで出発時切替
- [ ] 列情変更
- [ ] 方向幕確認
- [ ] 表示変更
- [ ] 到着20秒後 列情確認

## 47.11 手動設定

- [ ] 臨時停車
- [ ] 臨時通過
- [ ] 着発線
- [ ] 同列番で復元
- [ ] 別列番で復元しない

## 47.12 音声

- [ ] recorded
- [ ] synthetic
- [ ] 音声変更
- [ ] 音声停止
- [ ] 音量
- [ ] テスト音声
- [ ] MP3欠落フォールバック
- [ ] 同一キー30秒
- [ ] 開始後10秒
- [ ] バックグラウンド中にキューを積まない

## 47.13 iPad lifecycle

- [ ] 開始ボタン直後
- [ ] 地下起動直後
- [ ] 10秒バックグラウンド
- [ ] 1分バックグラウンド
- [ ] スリープ
- [ ] 復帰
- [ ] 自動音声再開
- [ ] 自動再開拒否時のみ音声再開ボタン
- [ ] 再開確認音
- [ ] 再開後の次案内
- [ ] Wake Lock再取得

---

# 48. Codex が最初に行うべきこと

新しい Codex セッションの最初は、いきなり修正しない。

次を行う。

1. `AGENTS.md` を読む
2. `MUST_FOLLOW.md` を読む
3. この `HANDOFF.md` を読む
4. 現在の `app.js` を読む
5. 現在の `styles.css` を読む
6. `data/` の実ファイル一覧を見る
7. 音声関連関数を確認
8. GPS / route / maybeSpeak / underground / midchange を確認
9. 文書と現行コードの差分があれば報告
10. その後にユーザーの依頼へ着手

---

# 49. 推奨する最初の Codex プロンプト

```text
このリポジトリは iPad で使用する鉄道乗務支援 Web アプリです。

まずコードを変更しないでください。

AGENTS.md、MUST_FOLLOW.md、HANDOFF.md をすべて読んでください。
その後、現行 app.js、styles.css、data/ を確認してください。

以下を整理して報告してください。

1. 現在の画面構成
2. state.config / state.runtime の主要状態
3. GPS → route lock → maybeSpeak の処理フロー
4. 190m / 400m / 200m / 通過案内のトリガー
5. 地下モード
6. 途中駅列情変更
7. 手動設定の保存・復元
8. 発車時刻・遅延・運行情報 API
9. recorded / synthetic 音声の処理
10. iPad の background / sleep 復帰処理
11. 文書と実コードに食い違いがある箇所
12. 現在の技術的リスク

まだコード変更は行わないでください。
```

---

# 50. 最後に

このプロジェクトで最も重要なのは、単発の「きれいな実装」ではなく:

- 現場仕様の保持
- 採用済み挙動の継続
- iPad 実機安定性
- GPS 誤判定の抑制
- 音声案内の欠落・重複防止
- 既存データとの互換
- 修正による副作用の最小化

である。

Codex は、一般的な Web アプリの設計原則よりも、このリポジトリに記録された現場要件と既存挙動を優先して作業すること。
