// The few WebExtension APIs DarkShell uses (Chrome and Firefox both expose
// them as `chrome.*` with promises in Manifest V3).

declare namespace chrome {
	namespace runtime {
		const id: string;
		interface MessageSender {
			id?: string;
			url?: string;
			origin?: string;
			frameId?: number;
			tab?: { id?: number; windowId?: number };
		}
		interface Port {
			name: string;
			postMessage(msg: unknown): void;
			disconnect(): void;
			onMessage: { addListener(cb: (msg: any, port: Port) => void): void };
			onDisconnect: { addListener(cb: (port: Port) => void): void };
			sender?: MessageSender;
		}
		function sendMessage(msg: unknown): Promise<any>;
		function connect(info: { name: string }): Port;
		function getURL(path: string): string;
		const onMessage: {
			addListener(cb: (msg: any, sender: MessageSender, sendResponse: (r: unknown) => void) => boolean | void | Promise<unknown>): void;
		};
		const onConnect: { addListener(cb: (port: Port) => void): void };
	}
	namespace storage {
		interface Area {
			get(keys: string | string[]): Promise<Record<string, any>>;
			set(items: Record<string, unknown>): Promise<void>;
			remove(keys: string | string[]): Promise<void>;
			setAccessLevel?(o: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
		}
		const session: Area;
		const local: Area;
		const onChanged: { addListener(cb: (changes: Record<string, { oldValue?: any; newValue?: any }>, area: string) => void): void };
	}
	namespace windows {
		function create(o: { url: string; type: 'popup' | 'normal'; width?: number; height?: number; focused?: boolean; left?: number; top?: number }): Promise<{ id?: number }>;
		function update(id: number, o: { focused?: boolean; drawAttention?: boolean }): Promise<unknown>;
		function remove(id: number): Promise<void>;
		function getLastFocused(): Promise<{ left?: number; top?: number; width?: number }>;
		function getCurrent(): Promise<{ id?: number }>;
		const onRemoved: { addListener(cb: (id: number) => void): void };
	}
	namespace tabs {
		function query(q: Record<string, unknown>): Promise<{ id?: number }[]>;
		function sendMessage(tabId: number, msg: unknown): Promise<unknown>;
		function create(o: { url: string }): Promise<unknown>;
	}
	namespace alarms {
		function create(name: string, o: { delayInMinutes: number }): Promise<void> | void;
		function clear(name: string): Promise<boolean>;
		const onAlarm: { addListener(cb: (a: { name: string }) => void): void };
	}
	/** Chrome 116+ (Firefox has sidebarAction instead) */
	const sidePanel: { open(o: { windowId: number }): Promise<void> } | undefined;
}
