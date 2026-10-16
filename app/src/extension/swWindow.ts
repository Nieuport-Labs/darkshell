// The background is a service worker: there is `self`, no `window`. secretjs's
// encryption (miscreant's AES-SIV, secure-random) reaches for `window.crypto`,
// so contract messages a site asked to encrypt (a token transfer) failed with
// "window is not defined". Imported first, before anything that encrypts.
if (typeof window === 'undefined') (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
