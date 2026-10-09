# Third-party code and designs

## StarShell Wallet — MIT

DarkShell's vault design (`app/src/lib/crypto/vault.ts`: Argon2id → HKDF-SHA256 → AES-GCM-256, 512-byte plaintext padding, production Argon2 cost) and the deterministic transaction-encryption seed idea (`app/src/lib/crypto/account.ts`) are adapted from StarShell, https://github.com/SolarRepublic/starshell-wallet. The repository declares the MIT license in its `package.json`.

    Copyright (c) Blake Regalia / Solar Republic

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## fee-granter (gas credits)

`app/src/lib/gas/feegrant-sdk.ts` (copied unchanged) and `app/src/lib/gas/gasCredits.ts` (adapted) come from https://github.com/jirkacepelka/fee-granter.

## Secret_Dashboard

From https://github.com/Nieuport-Labs/Secret_Dashboard:

- the design system: `app/src/design/tokens.css`, the Tailwind config, `Button`, `Modal` and `AmountHero` ports, the Send / Pay invoice / Receive / Create invoice dialogs;
- `app/src/lib/chain/shadeSwap.ts` (ported with only imports changed), `batchQuery.ts` (LCD path), `app/src/lib/pay/quote.ts` (from `gasPurchase.ts`) and the invoice-payment approach (`invoicePayment.ts` → `app/src/lib/pay/payments.ts`);
- `app/src/lib/tokens.ts`, generated from its token registry (itself adapted from dash.scrt.network, MIT) and IBC route table.

The `secret-pay` URI format is a superset of its invoice links.

## Fonts

Google Sans Flex (SIL Open Font License 1.1), self-hosted from `app/public/fonts`.

## Libraries

secretjs (MIT), @scure/bip39 (MIT), hash-wasm (MIT), qrcode-generator (MIT), barcode-detector (MIT), light-bolt11-decoder (MIT), Svelte (MIT), Vite (MIT). Capacitor (MIT), Tailwind CSS (MIT), Lucide icons (ISC), zxing-wasm (MIT).

## Round 4 dependencies

- [@noble/ciphers](https://github.com/paulmillr/noble-ciphers) and [@noble/hashes](https://github.com/paulmillr/noble-hashes) (MIT, Paul Miller): ChaCha20-Poly1305 and HMAC-SHA256 for SNIP-52 notifications; keccak-256 and SHA-256 for Ethereum, Bitcoin and Monero address checksums.
- [@capgo/capacitor-native-biometric](https://github.com/Cap-go/capacitor-native-biometric) (MIT): fingerprint unlock.
- [@capacitor/local-notifications](https://github.com/ionic-team/capacitor-plugins) (MIT, Ionic): phone notifications from the app. Its exact-alarm permission is removed from the merged Android manifest.
- [OkHttp](https://github.com/square/okhttp) (Apache-2.0, Square): the payment watcher's WebSocket.
- [tor-android](https://github.com/guardianproject/tor-android) (BSD-3-Clause, Guardian Project; bundles Tor, BSD-3-Clause, The Tor Project) and [jtorctl](https://github.com/guardianproject/jtorctl) (BSD-3-Clause): Tor inside the Android app.
- Tor onion logo (`app/src/components/wallet/TorIcon.svelte`, from Tor-logo-2011-flat.svg on Wikimedia Commons, reduced to one colour): a trademark of The Tor Project, Inc., used to show that the app is connected through Tor.
- [AndroidX WebKit](https://developer.android.com/jetpack/androidx/releases/webkit) (Apache-2.0): routing the WebView through Tor.
- SNIP-52 algorithms follow the specification in [SolarRepublic/SNIPs](https://github.com/SolarRepublic/SNIPs/blob/master/SNIP-52.md).
