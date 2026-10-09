# DarkShell

A mobile-first wallet for Secret Network that works like a bank account in one asset, **sSCRT**: a private balance, Send / Receive / Invoices, invoices payable in any token, and network fees paid from gas credits instead of SCRT.

```
app/                   the wallet: Svelte 5 + Vite + Tailwind, PWA and Android (Capacitor 8)
packages/secret-pay/   Secret Payment URI standard + reference library (to be published on its own)
site/                  landing page
release/DarkShell.apk  latest signed Android build (not committed)
```

## Install on Android

Copy `release/DarkShell.apk` to the phone and open it. Android asks once to allow installs from that source.

## Run and build

```bash
npm install
npm run dev
```

```bash
npm test
```

```bash
bash app/build-apk.sh
```

The APK build needs the Android SDK (path in `app/android/local.properties`) and JDK 21; the script uses Android Studio's bundled one. It is signed with `app/android/keystore/darkshell-release.jks`, and the passwords are in `app/android/keystore.properties`. Neither file is committed. **Back both up somewhere private.** Updates to an installed app must be signed with the same key.

## What it does

- **Account.**
  - A 24-word seed is created on the device (copy all with one tap, the word check can be skipped), or imported.
  - Several named accounts on one seed: `m/44'/529'/0'/0/n`, account 1 is the address Keplr shows. Tap the name on Home to switch, add or rename.
  - Unlocked with a 6-digit PIN. The seed is encrypted with Argon2id → HKDF → AES-GCM (StarShell's vault design) and stored in IndexedDB. After 5 wrong PINs the app waits 30 s, doubling each time (max 1 h).
  - The wallet auto-locks after 5 minutes, or after 1 minute in the background.
  - **Fingerprint unlock** (Android, optional): the PIN is kept in the Android Keystore under a key that only a fresh biometric check releases, and that is invalidated when fingerprints are added or removed.
  - **Emergency PIN** (optional, offered during onboarding): a second PIN that erases the real wallet from the phone, sends all sSCRT and SCRT of every account to a safe address in the background (only if one was set), and opens a decoy wallet — a separate recovery phrase generated at setup and never shown anywhere — as an ordinary unlock. From then on the same PIN simply unlocks the decoy. It is stored like the vault (own Argon2id salt, same padded size), and both PINs are always checked in parallel, so neither the stored data nor the unlock time tells them apart.
  - **Connect through Tor** (Android, optional, offered during onboarding): Tor runs inside the app (Guardian Project tor-android) and carries all traffic — the WebView via a proxy override, native HTTP and the payment watcher via the system proxy. It fails closed: the proxy is set before Tor is up. Settings → Network → "Check connection" asks check.torproject.org.
  - Android backup is disabled.
- **Balance and history** are read with a SNIP-24 permit. No viewing key and no transaction are needed.
- **Send** works for:
  - a `secret1…` address (private sSCRT, with an encrypted memo);
  - an `osmo1…` or `cosmos1…` address (unwrap and IBC in one transaction);
  - any scanned or pasted `address?asset=…` request, older `secret:` URI, `/pay/…` link or `addr:SYMBOL` short form.
- **Pay invoices in other tokens.** This follows Secret_Dashboard: the sSCRT is swapped on ShadeSwap and the swap carries a minimum return.
  - The recipient gets exactly the amount and token they asked for, in one transaction.
  - Any of 66 tokens can be requested, private or public (IBC).
  - Anything the swap returns above the invoice amount stays in the account as that token.
- **Lightning invoices** (scan, paste or open a `lightning:` link) are paid through FixedFloat. One Secret transaction swaps sSCRT → ATOM on ShadeSwap, unwraps it and sends it over IBC (channel-0) to FixedFloat's deposit address with the order memo; FixedFloat pays the invoice. The FixedFloat minimum changes with the market (about 0.63 ATOM ≈ 1,300 sats in October 2026). FixedFloat cannot be called from a browser (no CORS), so this works in the Android app only. The FixedFloat key is a partner (referral) key, so every screen that uses it says "Powered by FixedFloat". Progress is tracked under Activity; if FixedFloat cannot complete, a refund can be requested to the account's own `cosmos1…` address (same key). Needs a FixedFloat API key: built in at build time (`app/.env.local`, see `app/.env.example`) or entered in Settings.
- **Invoices.** Each has an amount, an id used as a private memo, and an expiry. It is shown as a QR code and shared as a link. DarkShell marks it paid when a matching transfer arrives; an invoice open on screen turns paid by itself, with an animation.
- **Payment notifications (SNIP-52).** sSCRT tags every transaction with encrypted notification ids. The app reads the newest sSCRT transactions from a public RPC node every few seconds and recognises its own locally with each account's notification seed (`channel_info`), so no server learns which payments are yours. Incoming payments show as an in-app notice (and a phone notification when the app is in the background). Optionally, also while the app is closed: a small native foreground service (`PaymentWatchService.java`) keeps one WebSocket to a public RPC node subscribed to sSCRT executions, so a payment is noticed as soon as its block lands (~6 s) and the phone sleeps in between. Android shows a silent "Watching for payments" notice while it runs; after a dropped connection the missed blocks are read over HTTP, and it restarts after a reboot or update. For that the seeds are kept in plain app storage (they can only recognise incoming payments).
- **Staking** (Staking tab), from the private balance and back:
  - **Stake:** one transaction unwraps sSCRT and delegates it.
  - **Claim rewards:** one transaction withdraws them and deposits them into sSCRT.
  - **Stake more or unstake with a validator:** the rewards that pays out are deposited in the same transaction. Rewards under auto-restake, or paid to another withdraw address, are left alone.
  - **After unbonding (21 days):** the SCRT comes back public, and the tab (like Home) offers *Make private*.
- **Governance:** open and recent proposals, the live tally against quorum, veto and threshold, and voting weighted by staked SCRT. Proposal text is shown as plain text only.
- **Accounts and address book.**
  - Restoring a phrase adds its other accounts that hold funds. *Add account* lists those that are not in the wallet yet.
  - Accounts can be removed: the funds stay, and adding the account again brings it back.
  - The address book is shared by all accounts, stored encrypted in the vault, and offered in Send. Own accounts are marked "Mine".
- **Fees.** Gas credits from the [fee-granter](https://github.com/jirkacepelka/fee-granter) vault pay first, then any other fee grant, then public SCRT.
  - Below 1 SCRT of credits, the next payment also converts 2 sSCRT into credits in the same transaction. This happens only when the payment leaves at least 2 sSCRT untouched.
  - Nothing is ever sent in the background.
- **Safe sending.**
  - Only one transaction can be in flight at a time.
  - Each transaction is signed once, and any retry re-sends the same bytes, so a retry cannot pay twice.
  - A slow confirmation shows as "pending" with the hash, never as a failure that invites pressing Send again.
- **Android.**
  - Secret Dashboard `/pay/…` links and `secret:` links from other apps open the payment.
  - The QR scanner uses the camera.
  - The back button closes dialogs, then tabs.
  - The scanner's WASM is bundled, so it makes no CDN calls.

## Phase 2

- Verify with FixedFloat that ATOM deposits arriving over IBC with the memo in the packet are credited (test with a small invoice first).
- Showing tokens other than sSCRT that end up in the account (swap leftovers, refunds on the Cosmos Hub).
- Payments to Ethereum through Axelar.
- A tool for funding the first gas credits.
- Shared invoices are Secret Dashboard links (`https://dashboard.nieuportlabs.cz/pay/…`, override with `VITE_PAY_ORIGIN`). For Android to open them in DarkShell without asking, the dashboard must serve `/.well-known/assetlinks.json` for `cash.darkshell.wallet`.

Third-party code: [THIRD_PARTY.md](./THIRD_PARTY.md).
