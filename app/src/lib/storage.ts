// Tiny IndexedDB key/value store. Everything secret goes through the vault
// first; this layer only ever sees ciphertext or public data.

const DB_NAME = 'darkshell';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
	return (dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => {
			dbPromise = null;
			reject(req.error);
		};
	}));
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
	return db().then(
		(d) =>
			new Promise<T>((resolve, reject) => {
				const tx = d.transaction(STORE, mode);
				const req = fn(tx.objectStore(STORE));
				tx.oncomplete = () => resolve(req.result as T);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			}),
	);
}

export const kv = {
	get: <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key)),
	set: (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key)),
	del: (key: string) => run<void>('readwrite', (s) => s.delete(key)),
	clear: () => run<void>('readwrite', (s) => s.clear()),
};

/** Data that belongs to one account lives under `<name>:<address>`. */
export function addrKey(name: string, address: string): string {
	return `${name}:${address}`;
}

/** Moves single-account data from before multi-account support to its account. */
export async function migrateLegacy(address: string): Promise<void> {
	for (const name of ['txlog', 'invoices', 'refill.until']) {
		const old = await kv.get<unknown>(name);
		if (old === undefined) continue;
		if ((await kv.get<unknown>(addrKey(name, address))) === undefined) await kv.set(addrKey(name, address), old);
		await kv.del(name);
	}
}
