# Store release: the on-chain build

Draft copy and declarations for shipping the build without an app backend
(`EXPO_PUBLIC_API_BASE_URL` empty). The facts below come from the code; the
store forms and any legal wording are the publisher's to confirm.

## 1. Order of operations

Existing users sign in with Privy and their key is held by Privy. The on-chain
build has no Privy login, so **a user who updates before exporting the key
cannot sign in to that wallet any more** until they export it from Privy's own
site.

1. Verify the migration with a real account first: note its Smart Wallet
   address, export the key at home.privy.io, import it in the new build
   ("I already have a wallet" → "Private key") and confirm the address and
   balances are the same. **Not verified yet** — do not publish the notice below
   until it is.
2. Publish the notice (section 2) where current users will see it *before* the
   update reaches them: the website, the release notes of the last backend
   build, and any channel you have. An in-app notice has to ship in a build that
   still has the Privy login.
3. Release the on-chain build. Leave automatic updates in mind: some users will
   get it without reading anything, which is why the release notes repeat the
   steps and why step 4 matters.
4. Keep the Privy app alive for as long as anyone may still need to export a
   key. Exporting does not depend on the old app or on the Kura backend, only on
   Privy.

What does not carry over: anything that lived on the backend — linked banks and
brokers (TrackFi), fiat on/off-ramp accounts, card waitlist position, referral
codes, the profile name and picture. Funds are not affected: they are in the
Smart Wallet on Base.

## 2. Notice to existing users

### English

**Kura is becoming a self-custody wallet — export your key before you update**

The next version of Kura no longer has accounts or sign-in. Your wallet key
will live only on your phone, and nobody — including us — can restore it.

If you already use Kura, do this **before updating**:

1. Open **home.privy.io** in a browser and sign in the same way you sign in to
   Kura (email, Google or Apple).
2. Export the private key of your wallet and keep it somewhere safe and
   offline.
3. Update Kura, choose **I already have a wallet → Private key**, paste the key
   and set an App PIN.

Your Smart Wallet address and your funds stay the same. Linked bank and
brokerage accounts, bank transfers, the card waitlist and referrals are no
longer part of the app.

Already updated? Your funds are safe. Do step 1 and 2 in a browser, then
step 3.

Never share the private key with anyone. Kura will never ask for it.

### 繁體中文

**Kura 即將改為自託管錢包：更新前請先匯出私鑰**

下一版的 Kura 不再有帳號與登入。錢包金鑰只會存在你的手機上，包含我們在內，
沒有任何人能替你找回。

如果你已經在使用 Kura，請在**更新之前**完成以下步驟：

1. 用瀏覽器開啟 **home.privy.io**，以你登入 Kura 的同一種方式登入（Email、
   Google 或 Apple）。
2. 匯出錢包的私鑰，離線保存在安全的地方。
3. 更新 Kura，選擇「**我已經有錢包 → 私鑰**」，貼上私鑰並設定 App PIN。

你的 Smart Wallet 地址與資金都不會改變。已連結的銀行與券商帳戶、銀行轉帳、
卡片候補名單與推薦碼不再是 App 的功能。

已經更新了？資金仍然安全。請先在瀏覽器完成步驟 1 和 2，再做步驟 3。

請勿把私鑰告訴任何人。Kura 永遠不會向你索取私鑰。

### Release notes (short form)

> Kura is now a self-custody wallet with no account. Existing users: export your
> private key at home.privy.io, then choose "I already have a wallet" after
> updating. Your address and funds do not change.

> Kura 現在是不需帳號的自託管錢包。舊用戶請先到 home.privy.io 匯出私鑰，更新後
> 選擇「我已經有錢包」匯入。地址與資金不變。

## 3. What the on-chain build sends off the device

There is no Kura server, no account, no email and no analytics or crash
reporting SDK in the build. The app talks to these third parties directly, and
each of them sees the device's IP address plus what is listed:

| Service | Receives | Why |
|---------|----------|-----|
| Base RPC (`mainnet.base.org`, `base-rpc.publicnode.com`, or the one you configure) | Wallet address, the transactions being read or sent | Balances, sending |
| Pimlico bundler | The signed transaction (user operation) | Sending from the Smart Wallet |
| Safe Transaction Service | Wallet address | Transaction history |
| Li.Fi | Wallet address, the tokens and amount of a quote | Swap and bridge |
| Morpho API | Vault and market queries; wallet address for positions | Earn and Borrow |
| CoinGecko | Token ids; fixed image URLs | Prices and token logos |
| Reown (WalletConnect) relay | Encrypted session messages | Connecting to dApps, only when used |

Stays on the device: the wallet key and recovery phrase (Keychain / Keystore),
the App PIN, the display name and profile picture, dApp session history.

## 4. Store declarations

### App Store — App Privacy

- **Data collected by the developer: none.** No account, no contact info, no
  identifiers, no usage data, no diagnostics.
- Tracking: **No.**
- The wallet address and IP address do reach the third parties in section 3 in
  order to carry out what the user asked for. Read Apple's definition of
  "collect" against that table before answering "Data Not Collected"; if in
  doubt, declare *Financial Info → Other Financial Info* and *Identifiers →
  User ID* as **not linked to identity, not used for tracking, App
  Functionality**.
- Account deletion: there is no account. The in-app equivalent is Settings →
  "Remove wallet from this device".

### Google Play — Data safety

- Data collected: **none**. Data shared: the wallet address with the services
  in section 3, for app functionality (same caveat as above).
- Data is encrypted in transit: **Yes** (HTTPS only).
- Users can request deletion: no account exists; removing the wallet deletes
  everything the app stored.

### Privacy policy and review notes

- The privacy policy and terms are served from the website
  (`brand.homepage`), not from this repository: remove the sections about
  accounts, email, Plaid, identity verification and the card, and add the table
  from section 3.
- Review notes: the app is a non-custodial wallet; there is no demo account —
  the reviewer taps "Create a new wallet".

## 5. Open item: permission strings

`app.config.js` still declares permissions that only the backend features use,
with purposes that no longer exist in this build:

| Permission | Declared purpose | Used by the on-chain build? |
|------------|------------------|-----------------------------|
| Camera | QR codes, profile photo, identity verification | Yes — QR scanning, profile photo |
| Photo library | Identity documents, profile picture | Yes — profile picture only |
| Microphone | Liveness video for identity checks | No |
| Location | Country detection for identity verification | No |
| Local network | "Connect to financial services" | Not known to be needed |

A store reviewer can question a declared permission the app never requests, and
the wording contradicts "no identity data". Removing them for the on-chain
build means making these entries depend on `EXPO_PUBLIC_API_BASE_URL` and
re-testing a release build on a device; that has **not** been done.
