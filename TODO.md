# TODO — 社區版（無後端）上線前

> 工作筆記，對應 PR「On-chain community edition」。全部完成後請刪除這個檔案。
> 相關 PR：WebClients 與 BackendServer 的同名分支 `claude/awesome-ritchie-i1bwnp`。

這個分支的變更通過了型別檢查、單元測試與 lint（`npm test && npm run lint && npx tsc --noEmit`），**沒有在實機上跑過**。

2026-11-14 在 iOS 模擬器（iPhone 17、iOS 27、Xcode 27.2，Debug build + Metro，無後端）跑過一輪 smoke test。下面標「模擬器已驗」的就是這一輪；模擬器沒有生物辨識、沒有資金，實機仍要再跑。
建置備註：`npx expo run:ios` 在 Xcode 27 找不到 Simulator app 而中止，這一輪是 `expo prebuild` → `pod install` → `xcodebuild` → `expo start --dev-client` 分開跑的。

## 1. 實機驗證（`EXPO_PUBLIC_API_BASE_URL` 留空）

- [ ] 首次開啟顯示「建立新錢包／我已經有錢包」，不出現 Privy 登入
      模擬器已驗
- [ ] 建立錢包：顯示 12 字助記詞，勾選後才能繼續；之後要求設定 App PIN
      模擬器已驗（設定與確認 PIN 後進主畫面）
- [ ] 匯入助記詞（12 字）與匯入私鑰（64 hex）都能進到主畫面
- [ ] 冷啟動後要求解鎖（生物辨識／PIN），解鎖後回到同一個錢包
      模擬器已驗 PIN：錯誤 PIN 被拒，正確 PIN 回到同一個錢包。生物辨識未驗
- [ ] 送一筆小額 USDC、做一次 Swap、連一個 WalletConnect dApp 並簽名
- [ ] Morpho Earn 存入／提出各一次
- [ ] 設定 → Profile & Security → 助記詞：需通過 App 鎖才顯示，截圖被擋
      模擬器已驗：要先輸入 PIN 才顯示，顯示的 12 字與建立時相同。**截圖是否被擋無法在模擬器判斷**（模擬器的畫面擷取看得到助記詞），要在實機確認
- [ ] 設定 → 從此裝置移除錢包：有確認對話框；移除後回到建立／匯入畫面
      模擬器已驗
- [ ] 鎖定畫面「忘記 PIN」：只能走移除錢包，取消後 PIN 仍在、錢包仍在
      模擬器已驗（修正後）。原本會先跳一個寫著「登出後再登入即可重設 PIN」的後端模式對話框，再跳移除確認；現在本機錢包模式直接顯示移除確認
- [ ] 沒有設定生物辨識的 Android 裝置上也能建立錢包（會退回一般金鑰庫）
- [ ] 每次簽名的系統驗證提示是否可接受；太頻繁的話再調整金鑰的儲存選項
- [ ] 加值只顯示 USDC 收款地址；轉帳只顯示加密貨幣收款人；首頁沒有卡片橫幅
      模擬器已驗：加值只有 USDC 地址與 QR、首頁沒有卡片橫幅；Invest 只有 Cash／Earn／Crypto，Borrow、Portfolio 正常載入。轉帳頁沒有點進去
- [ ] 全程沒有任何請求送往 `api.kura-finance.com` 或 Privy

## 2. 地址一致性

- [x] 同一組助記詞在手機與網頁顯示同一個 Safe 地址
      模擬器上新建錢包顯示的 EOA 與 Safe 地址，和用同一組助記詞以 WebClients 的推導方式算出來的完全相同
- [x] 對真實鏈跑一次比對腳本，兩邊輸出相同：
      `node scripts/safe-address-parity.cjs . https://mainnet.base.org`
      `node scripts/safe-address-parity.cjs ../WebClients https://mainnet.base.org`
      2026-11-13 跑過，兩邊的三種推導都是 `0xf78B124D0f676153b37b7852658B5000b390984B`
- [ ] **舊用戶搬遷**：拿一個現有帳號，記下目前的 Safe 地址 → 到 home.privy.io 匯出私鑰 → 新版「匯入 → 私鑰」→ 地址不變、資金看得到

## 3. 有後端的模式（自架者會用到）

- [ ] 設定 `EXPO_PUBLIC_API_BASE_URL` 與 Privy 金鑰後，Privy 登入、TrackFi、法幣出入金、卡片、推薦、刪除帳戶都和改動前一樣

## 4. 發佈

- [ ] GitHub → Settings → Code security → CodeQL analysis（Default setup）→ Edit：把 **JavaScript/TypeScript** 加進語言。目前預設掃描只涵蓋 `actions`；repo 裡的自訂 CodeQL workflow 因為和預設掃描衝突，從九月底起每次上傳結果都被拒，已在這個分支移除

- [ ] 打包時 `EXPO_PUBLIC_API_BASE_URL` 留空；Privy 金鑰不需要
- [ ] 更新商店的隱私與資料收集聲明（不再有帳戶、不再收集 email）
- [ ] 上架說明／App 內公告：舊用戶更新前先到 home.privy.io 匯出私鑰；助記詞遺失無法找回
- [ ] Privy app 保留到沒有人需要匯出私鑰為止

## 5. 之後再做

- [ ] Privy SDK 在無後端時仍被打包（不載入）；要瘦身需改成動態載入
      網頁端已用 build 時的別名處理。手機這邊沒做：Privy 在 `App.tsx` 與 `lib/auth` 是靜態 import，要在 Metro 換成替身，而換錯的結果是 App 一啟動就當掉，只有實機才看得出來。等第 1 段實機驗證做完再動
- [x] `ImportWalletScreen`（舊的 App 內匯入畫面）沒有任何入口，且預覽地址用的是 SimpleAccount 而非 Safe；刪除或修正
      已刪除，連同 `KuraCardScreen` 裡永遠不會顯示的分支
- [x] 舊用戶更新後「已連線的 dApp 紀錄」會清空（紀錄以使用者 id 為鍵，id 已改變）
      裝置上只留有一個舊帳號的紀錄時，第一次載入會搬到 `local:<地址>` 底下；有多個舊帳號就不搬。有單元測試，沒有在實機上驗過
- [x] 乾淨的 checkout 跑 `npx expo prebuild` 會失敗（`[ios.entitlements] … xml declaration which is only at the start of the document`）：`overrides` 把 `@xmldom/xmldom` 釘在 0.9，它不接受 XML 宣告前有任何字元，而 Expo 自己的 entitlements 範本開頭是一個換行。只要 `ios/` 還不存在就會遇到
      `patches/@expo+plist+0.4.9.patch` 多加一個 `trimStart()`；刪掉 `ios/` 重跑 prebuild 已確認成功
- [x] **設定頁的「忘記 PIN」會在確認前就清掉 PIN**（`ProfileSecurityScreen`）：本機錢包模式下按「忘記 PIN」→ 在移除錢包的確認框按取消，PIN 已經被清空，錢包還在。拿到已解鎖 App 的人可以藉此丟掉 PIN、設一個新的，再用新 PIN 看助記詞
      本機錢包模式改成和鎖定畫面一樣：PIN 留到使用者確認移除錢包才清。模擬器已驗：取消後原 PIN 仍然有效。這個問題是讀程式發現的，修正前沒有在模擬器上重現過
- [x] 帳戶頁標題在本機錢包模式顯示「Signed out」
      沒有顯示名稱時改顯示「My wallet／我的錢包」
- [x] 本機錢包模式停在鎖定畫面超過 60 秒會記一筆 `Sign-in watchdog fired` 錯誤（開發模式會跳紅色提示），其實沒有登入流程在等
      watchdog 在本機錢包模式不再啟動
- [x] **首頁歷史紀錄顯示「Blockscout error 403」**：`base.blockscout.com/api` 對所有 API 請求回 Cloudflare 驗證頁（`cf-mitigated: challenge`），連瀏覽器直接開也一樣，所以手機與網頁都讀不到交易紀錄
      交易紀錄改由兩個免金鑰的來源合併（`src/lib/chain/walletTransfers.ts`，與 WebClients 的 `app/lib/chain/walletTransfers.ts` 是同一份檔案，改一邊要同步另一邊）：
      - **Safe Transaction Service**（`api.safe.global/tx-service/base`）：已部署的 Safe 的完整紀錄，可分頁，連部署前收到的款項都有（用鏈上真實的 Safe 驗證過）。它會知道查的是哪個錢包地址
      - **Base RPC 的 Transfer 事件**：補上還沒部署的錢包（收過款但沒轉出過）和索引延遲的那幾分鐘。公用 RPC 一次只給 50,000 個區塊、最多 10 個合約，而 Base 現在 0.2 秒一塊，所以只往回掃約 7 天、只涵蓋 App 支援的代幣
      - 還沒部署的錢包不可能轉出過，所以收款加總等於餘額就代表紀錄完整；沒有任何餘額就完全不掃
      已驗：單元測試 22 個；對真實服務實測（已部署的 Safe 第一頁 7 個請求、列出全部收付款）；模擬器上新錢包首頁顯示「No transactions yet」、沒有錯誤。**沒驗到**：模擬器上有紀錄的錢包的實際畫面（需要有資金的錢包）
- [ ] 交易紀錄的已知限制：(1) 還沒部署、且收款超過約 7 天的錢包，在第一次轉出前看不到那筆收款；(2) 原生 ETH 轉帳不列出（和以前一樣）；(3) Safe Transaction Service 目前免金鑰、有流量上限，官方若改成必須帶 key 就要申請或換來源
- [ ] Portfolio 空狀態寫「tokens and stocks」，無後端時沒有股票
- [ ] `useKuraCardWallet` 的 `importWallet` 在刪掉 `ImportWalletScreen` 後已沒有任何呼叫端
- [x] 首頁錢包設定失敗畫面的「再試一次」按鈕沒有作用：`useKuraCardWallet` 沒有重試的入口（改動前就是這樣）
      hook 新增 `retryProvision()`，按鈕會重跑一次錢包設定。沒有在實機上驗過
