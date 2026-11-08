# Session Board

同時檢視多個 Codex Session 的本機任務看板，提供最後 prompt 時間排序、Need you 快捷篩選、Project + Branch 分組，以及 tool／reasoning／outputting 即時活動狀態。桌面使用卡片網格，手機維持雙欄。

專案直接位於儲存庫根目錄，使用 Bun workspace 管理 React 前端與共用套件，由 Node HTTP／SSE 服務讀取既有 Codex Session 並訂閱本機共享 daemon。

前端源自 [tombelieber/claude-view](https://github.com/tombelieber/claude-view/tree/d3e4ad89f3847d702f33381735e97dc397fb196d)（上游版本 0.46.2，commit `d3e4ad8`），保留上游 MIT 授權與共用套件名稱。Session Board 版本獨立管理。

## Codex 接入

預設 `bun start`／`npm start` 仍使用 Node.js 執行後端。若已安裝 Bun，也可選擇以 Bun 執行同一個後端：

```sh
bun run start:bun
# 或 npm run start:bun
```

兩種執行方式使用相同的設定與參數，例如 `npm run start:bun -- --host`。Bun 執行方式目前為可選實驗功能；基本 HTTP 服務已驗證，即時 daemon 活動與回覆仍待完整驗證。測試維持使用 Node.js。

```sh
bun install
bun run build
bun start
```

在儲存庫根目錄執行以上指令，開啟 http://127.0.0.1:4174 。需要其他埠時使用 `npm start -- --port 4175` 或 `PORT=4175 bun start`；命令列參數優先於環境變數。若指定或預設的埠已被佔用，會自動依序嘗試下一個可用埠，並在啟動訊息印出實際使用的網址；目前本機預覽使用 4175。`bun run start:codex` 保留為相同的啟動入口。

局域網存取可使用 `npm run start -- --host`（監聽 `0.0.0.0`），再由其他裝置開啟 `http://這台電腦的局域網IP:4174`。也可用 `npm run start -- --host 192.168.0.160` 或 `--host=192.168.0.160` 僅監聽指定介面。不帶參數時預設為 `127.0.0.1`；仍支援 `HOST` 環境變數，`--host` 優先於環境變數。

- 自動發現 `$CODEX_HOME/sessions`，預設為 `~/.codex/sessions`；也讀取 `archived_sessions` 與 `session_index.jsonl`（存在時）。背景觀察不修改 Codex 設定或啟動新回合。存在共享 daemon 時會加入其已載入的 Session 訂閱活動，不傳入設定覆寫；只有使用者明確提交的答案或批准決定會送回原 Session。
- 同一個既有前端由本機 Node HTTP/SSE 服務提供資料，每兩秒檢查紀錄變化；對話、任務與計畫每三秒更新。無須新增 API key。
- 支援舊版 `response_item`／`event_msg` 與本機 Codex 0.166.0 的 `item_completed` 格式；讀取使用者／助手訊息、工具結果、`update_plan` 計畫、已記錄的檔案修改與子 Agent 關係。系統指令及原始 reasoning 不顯示；即時狀態只使用 reasoning 的公開摘要。
- Board 顯示最近七天，最多 100 個未結束紀錄與 20 個已結束回合；完整主 Session 列表保留在 Sessions。子 Agent 不重複列為獨立主任務。
- 歷史總覽只讀首 128 KiB 與尾 256 KiB，避免反覆讀完整個歷史目錄。最近 24 小時修改的紀錄與所選詳情會完整解析，單檔上限 64 MiB。詳情快取最多四份。
- Live API 只允許監聽介面位址的同源存取。寫入入口限使用者明確提交的非同步答案與已接收的即時請求回覆；其他修改方法一律拒絕。紀錄讀取失敗不會切回模擬資料。

### 能力與界線

| 現有介面 | Codex 接入 |
| --- | --- |
| 專案、Session、標題、分支、模型 | 從既有紀錄讀取 |
| 對話、最近活動、工具結果 | 已接入，紀錄更新後同步 |
| Tasks／Plan | 顯示 Codex 實際寫入的計畫；未寫入則不虛構 |
| Running 卡片即時活動 | 自動連線既有共享 daemon 的 Unix WebSocket，顯示 `tool: …`、`reasoning: 公開摘要`、`outputting`；無明確活動時顯示 `running` |
| Working／Idle／Interrupted／Error | 已載入 Session 優先使用 daemon runtime；其他使用紀錄事件，超過三分鐘沒有事件時標為 State unverified |
| Finished turns | 僅代表收到 `task_complete`，不代表整個任務完成或 CLI 已退出 |
| Waiting for input | 依明確請求事件、daemon 等待旗標或已接受的非同步提問顯示；非同步提問跨回合結束保留 Need you，收到下一則使用者訊息後清除；不能從未結束的工具呼叫推斷批准等待 |
| 搜尋 | 標題、專案與已索引的訊息片段；不是整份歷史的全文搜尋 |
| 檔案變更 | Session 側欄顯示成功的 native FileChange 檔名與增刪行數，可展開紀錄中的 exact unified diff；缺少 diff 時不可展開，行數顯示 —。行數累計每次修改，不代表 Git 淨差異 |
| 問題與回覆 | 看板卡片直接顯示完整問題、選項與文字欄位；Session 對話頁也可回答。連線到既有 daemon Session 時可送出答案，等待 Codex 確認後清除；亦可繼續在原本的 Codex 客戶端回答 |
| Command／File change 批准 | 已接入即時請求，可允許一次、允許本 Session、拒絕或取消；顯示命令、網路目標或已接收的檔案修改內容 |
| 額外網路／檔案權限 | 可授予原請求的權限（本回合或本 Session），或拒絕；不接受前端自行擴充的權限 |
| 阻塞式問題／Plan 確認 | 透過實際 `requestUserInput` 顯示問題、選項及密碼欄位，回覆原工具請求；不另造 Plan 批准狀態 |
| MCP 表單／URL 確認 | 支援標準文字、數字、布林與列舉欄位，以及使用者手動開啟的 URL 確認；未知 schema 請回原客戶端操作 |
| 其他 Agent 控制 | 尚未接入；繼續在原本的 Codex CLI／編輯器操作 |
| AI 摘要／離開期間差異 | 未新增；目前只呈現紀錄本身已有的內容 |

本機 Codex 0.166.0 已實測可透過 `~/.codex/app-server-control/app-server-control.sock` 加入共享 daemon 的既有 Session。背景觀察只使用初始化、列出／讀取已載入 thread 與無覆寫的 `thread/resume` 訂閱事件。只有按下 Send answer 才以無設定覆寫的 `turn/start` 將答案送回同一 thread（工作中追加輸入，閒置時開始新回合）。問題回覆 envelope 採用本機 0.166.0 原生客戶端紀錄格式，並非跨版本穩定合約；升級時須重新驗證。可用 `AGENTHUD_CODEX_SOCKET` 指定另一個 Unix socket；未連線時自動重連並繼續讀取紀錄。以 `--no-daemon` 啟動的獨立 CLI 不會被這個共享 daemon 監聽，需在原本的客戶端回答。

即時批准、阻塞式問題與 MCP 確認只處理此 WebSocket 實際收到的 server request，回覆原 JSON-RPC request ID，不另開回合；收到 `serverRequest/resolved` 後才確認完成。原客戶端作答也會同步清除。斷線、回合結束或項目完成會作廢舊請求；逾時未確認時保留等待狀態並阻止重複送出。若只有等待旗標、未收到請求內容，仍需在原客戶端操作。協定依本機 0.166.0 生成型別驗證，HTTP／WebSocket／瀏覽器測試使用模擬 daemon，不會執行真實批准命令。

官方參考：[App Server](https://learn.chatgpt.com/docs/app-server)、[Hooks](https://learn.chatgpt.com/docs/hooks)。JSONL 是本機版本實測的儲存格式，不當作穩定的官方 API 合約；版本改動需重新驗證。

驗證：

```sh
bun run test:codex
bun run test:codex:browser
```

瀏覽器驗證使用臨時 Codex 紀錄，檢查追加事件、計畫同步、回合結束與失效時不回退 mock。可用 `CODEX_LIVE_URL=http://127.0.0.1:4175 bun run test:codex:browser` 額外檢查本機實例，截圖只取 `CODEX_PROJECT` 指定的專案（預設為此工作目錄）。

## 前端開發與 Demo


```sh
bun install
bun run dev
```

開發時接入真實 Codex 資料，可先用 `PORT=4176 bun start` 啟動 API，再執行 `AGENTHUD_API_TARGET=http://127.0.0.1:4176 bun run dev`。

打开 http://localhost:5173 。不需要安装 Claude CLI、登录或配置 API key。

```sh
bun run typecheck
bun run build
bun run preview
```

生产文件位于 `apps/web/dist/`。Mock 数据也包含在生产构建内；静态托管时请将页面路由回退至 `index.html`。

## 改進內容

- Live Monitor 使用混合 Session 卡片網格：桌面依寬度顯示多欄、手機固定雙欄；移除三個狀態欄；Filter 保留 None／Project + Branch 排版模式，分組內仍依最後 prompt 時間排序。
- 保留專案與分支篩選、搜尋、近期關閉 Session、歷史紀錄、Session 詳情、對話、任務、計畫、檔案變更與子 Agent 記錄。
- 移除 Analytics／Activity／Reports／Prompts／Memory／Teams／Workflows／Plugins／System Monitor 等非核心頁面，以及帳號、裝置、分享、建立／恢復 Agent 的操作入口。
- 移除看板、卡片與詳情中的費用／token 統計；Settings 收斂為保留功能的快捷鍵說明。
- 清理已無引用的頁面、元件、Hooks、樣式及其專用測試。已移除的頁面網址返回 Board，既有 Session 詳情連結仍可使用。

已依序完成上下欄重排、Zinc 深色基底、系統字體、任務資訊層級與 UI 精調：

- 頂欄集中位置、搜尋、通知與設定；底欄統一顯示即時連線、事件新鮮度及 demo 標示。
- 依最後一次使用者 prompt 時間由新到舊排列；工具、reasoning 與文字輸出不會改變順序。Need you 為獨立快捷篩選，關閉後恢復 running／idle 的原有選擇；搜尋、專案與分支條件保持有效。
- 任務卡顯示小圓點狀態、最後 prompt 的相對時間、最多 50 字的標題／prompt，以及 running 的即時活動文字；running／idle 篩選集中在 popover。
- 使用 Zinc 表面與選取狀態，綠／琥珀／紅保留為狀態強調。使用系統字體，統一留白、鍵盤焦點與窄視窗行為。

靜態預覽與 `bun run dev` 保留 mock demo。`bun start` 讀取本機真實 Codex Session；OpenCode／Crush 尚未接入，也沒有新增 AI 語意摘要或離開期間差異追蹤。

執行 `npm run dev` 後，running 卡片會展示 tool／reasoning／outputting 圖示，每 4 秒輪換階段，並播放文字垂直滑動淡入淡出的切換動畫。

## Mock 数据位置

- `apps/web/src/demo/data.ts`：项目、会话、对话内容。
- `apps/web/src/demo/api.ts`：API 路由与筛选、分页。
- `apps/web/src/demo/install.ts`：浏览器 fetch / SSE / WebSocket 适配。
- `apps/web/src/demo/defaults.json`：由上游类型生成的完整基础响应。

`apps/web/src/main.tsx` 在 React 掛載前辨識資料來源，只在 demo 模式安裝 mock。上游 Sentry 初始化已移除，遥测禁用。

## 浏览器验证

启动开发服务器后执行 `bun run test:demo`。需要 Playwright Chromium；可使用 `CHROMIUM_PATH` 指定浏览器，`DEMO_URL` 指定预览地址。驗證 Board、即時事件更新、篩選、搜尋、詳情、退役路由與快捷鍵，並在 `artifacts/dashboard-*.png` 保存深色截圖。

保留上游 MIT 许可证，见 `LICENSE`。仅提取 `apps/web`、`packages/shared` 和 `packages/design-tokens`；未复制 Rust 服务与其他应用。

## 專案結構

- `apps/web/`：React 前端與 Vite 建置。
- `packages/shared/`、`packages/design-tokens/`：共用元件、型別與配色。
- `server/`：Codex 紀錄讀取、本機 daemon 活動訂閱與 HTTP／SSE API。
- `scripts/`：瀏覽器驗證。
- `artifacts/`：本機驗證截圖，不納入 Git。

依賴、建置結果、測試報告與環境變數檔不納入 Git；以 `bun.lock` 固定依賴版本。
