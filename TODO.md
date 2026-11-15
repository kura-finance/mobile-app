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
      2026-11-15 補做：手機（模擬器）與網頁實際各匯入一次 `abandon … about`，兩邊都顯示 `0xf78B124D0f676153b37b7852658B5000b390984B`
- [x] 對真實鏈跑一次比對腳本，兩邊輸出相同：
      `node scripts/safe-address-parity.cjs . https://mainnet.base.org`
      `node scripts/safe-address-parity.cjs ../WebClients https://mainnet.base.org`
      2026-11-13 跑過，兩邊的三種推導都是 `0xf78B124D0f676153b37b7852658B5000b390984B`
- [ ] **舊用戶搬遷**：拿一個現有帳號，記下目前的 Safe 地址 → 到 home.privy.io 匯出私鑰 → 新版「匯入 → 私鑰」→ 地址不變、資金看得到

## 3. 有後端的模式（自架者會用到）

- [ ] 設定 `EXPO_PUBLIC_API_BASE_URL` 與 Privy 金鑰後，Privy 登入、TrackFi、法幣出入金、卡片、推薦、刪除帳戶都和改動前一樣

## 4. 發佈

- [x] CodeQL 預設掃描只涵蓋 `actions`，要把 **JavaScript/TypeScript** 加進語言
      2026-11-15 用 GitHub API 送出設定變更（`javascript-typescript`），GitHub 的「CodeQL Setup」工作跑完且成功，語言清單現在是 actions、javascript、javascript-typescript、typescript。WebClients 本來就有

- [ ] 打包時 `EXPO_PUBLIC_API_BASE_URL` 留空；Privy 金鑰不需要
- [ ] 更新商店的隱私與資料收集聲明（不再有帳戶、不再收集 email）
      草稿在 `docs/store-release.md` 第 3、4 節：無後端版會把什麼送給哪些第三方、App Store 與 Google Play 表單建議的答案。**表單要你本人填**；官網的隱私權政策不在這個 repo 裡，也要改
- [ ] 上架說明／App 內公告：舊用戶更新前先到 home.privy.io 匯出私鑰；助記詞遺失無法找回
      中英文公告與 release notes 短版寫在 `docs/store-release.md` 第 1、2 節，含發佈順序。**公告裡「地址與資金不變」要等下面「舊用戶搬遷」用真實帳號驗過才能發**
- [ ] `app.config.js` 仍宣告只有後端功能會用到的權限（麥克風、定位、區域網路），用途文字還寫著身分驗證；和「不收集身分資料」的聲明矛盾，審核可能會問。要依後端網址決定是否宣告，並在實機上重測 release build，還沒做（`docs/store-release.md` 第 5 節）
- [x] 文件有 5 處寫「官方後端已停用（retired）」（README、`docs/handover.md`、`official-services.md`、`local-release.md`、`transparency.md`），但後端目前仍在線上
      改成「仍服務目前上架的版本，預計 2027 年停機」。真正停機後，這 5 處要再改回「已停用」
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
- [x] 還沒部署、且收款超過約 7 天的錢包，在第一次轉出前看不到那筆收款
      改成從餘額歷史找：還沒部署的錢包只能收不能轉，每種代幣的餘額只會一階一階往上，用過去區塊的 `balanceOf` 二分搜尋每一階所在的區塊，再讀那一個區塊的 Transfer 事件。不需金鑰，要 RPC 提供過去狀態（mainnet.base.org、drpc 可以；publicnode 要 key），沒有時退回原本的掃描。每種代幣最多找 25 筆。2026-11-16 用 admin 帳號的錢包實測：2026-07-20 收到的 EURC 和 WETH 都列出來，約 5.5 秒、95 個請求
- [ ] 交易紀錄的已知限制：(1) 原生 ETH 轉帳不列出（和以前一樣）；(2) Safe Transaction Service 目前免金鑰、有流量上限，官方若改成必須帶 key 就要申請或換來源；(3) 公用 RPC 連續大量查詢會被限流，找收款時會重試，仍失敗就退回原本只掃約 7 天的方式
- [x] 交易紀錄把代幣數量當成美元顯示：WETH 0.00008 顯示成 +$0.00、EURC 0.0899 顯示成 $0.09
      改成：美元穩定幣照舊顯示美元；EURC、BRZ、MXNe 用匯率換成美元；其他代幣（WETH、cbBTC，以及沒有匯率的 XSGD、AUDD）顯示代幣數量，例如「+0.000080 WETH」。交易紀錄沒有當時的價格，所以不估美元。網頁版本來就是這樣顯示，不用改
- [x] Portfolio 空狀態寫「tokens and stocks」，無後端時沒有股票
      沒有股票功能時改顯示「…to find tokens.」（新增 `crypto.portfolioEmptyTokensOnly`，中英文都有）；模擬器上看過
- [x] `useKuraCardWallet` 的 `importWallet` 在刪掉 `ImportWalletScreen` 後已沒有任何呼叫端
      已從 hook 與型別移除。讀取舊版匯入金鑰的路徑沒有動（有後端的舊用戶仍可能用到）
- [x] 首頁錢包設定失敗畫面的「再試一次」按鈕沒有作用：`useKuraCardWallet` 沒有重試的入口（改動前就是這樣）
      hook 新增 `retryProvision()`，按鈕會重跑一次錢包設定。沒有在實機上驗過
- [x] **沒有 logo.dev 金鑰時代幣圖示全部變成 emoji／字母**：圖示只有 logo.dev 一個來源，而社群版預設沒有金鑰；備援的 Clearbit 也早已停止服務
      新增 `src/config/tokenLogos.ts`（與 WebClients 的 `app/lib/tokenLogos.ts` 是同一份檔案，改一邊要同步另一邊）：39 個代幣與 6 條鏈各對應一個 CoinGecko 公開圖片 CDN 的固定網址，免金鑰。本來就向 CoinGecko 查價格，所以沒有多出新的第三方；每個使用者載入的網址都一樣，不會洩漏持有哪些資產。有設 logo.dev 金鑰時行為不變。Clearbit 備援已移除
      已驗：單元測試（清單裡每個代幣在沒有金鑰時都有圖示）；模擬器的 Invest 頁 Cash／Crypto 清單都顯示真實圖示，`cb` 角標照舊。**沒驗到**：轉帳／跨鏈畫面的鏈圖示（只有測試）
- [ ] 圖示的已知限制：(1) 股票、金庫管理人、清單以外的代幣（Morpho 的長尾抵押品）仍是字母；Morpho 自己的圖示是帶 `<style>` 的 SVG，react-native-svg 畫不出來；(2) 圖片網址寫死，CoinGecko 若改檔名該圖示會退回字母，離線時也是
- [x] 「有沒有後端」有三種問法並存：`features.backend`、`hasAppBackend()`（7 個檔案 12 處）、`isLocalSessionMode()`（8 個檔案）
      全部改成 `src/config/features.ts` 的旗標，`isLocalSessionMode()` 已刪除；`src/config` 以外不再有人呼叫 `hasAppBackend()`。兩種模式共用卻叫 Privy 的名稱一併改掉：`setPrivySession` → `setAuthSession`、`privyLogout` → `endSession`、`hasPrivyUser` → `hasUser`，`useAppStore.ts` 的檔頭與過時註解重寫。行為不變；模擬器上重跑過解鎖進首頁。**沒重跑**：建立錢包、移除錢包
- [x] Kura 標誌在深色主題下看不見（App PIN、設定 PIN、Face ID、登入四個畫面）：標誌是深色線條配透明背景
      深色主題下用 `tintColor` 改成文字色；模擬器上驗過 App PIN 畫面，其餘三個畫面是同一個寫法但沒有逐一看
- [ ] 切換寫法還沒整理的部分：(1) `useAppStore.ts`（7 處）、`App.tsx`（7 處）、`useKuraCardWallet.ts`（2 處）裡仍是就地的 `if (features.backend)`，比較乾淨的做法是把 session 來源做成一個物件、兩個實作，改完要重跑建立／解鎖／移除錢包；(2) 無後端時仍打包 Privy SDK（`authSession.ts` 靜態 import）
- [x] 整理切換寫法後重跑登入流程（2026-11-15，模擬器，深色主題）
      冷啟動要求 PIN → 「忘記 PIN」直接出現移除確認 → 取消後錯的 PIN 仍被擋下 → 確認移除後回到歡迎畫面 → 匯入參考助記詞（`abandon … about`）→ 設定 PIN → 首頁；之後再移除一次並走「建立新錢包」到首頁。全部通過
- [ ] 測試曾經偶發失敗一次（359 個裡 1 個），沒抓到是哪一個；之後單獨跑 9 次、兩個同時跑 60 次都全數通過，無法重現。當時同一時間正在關閉 Metro
