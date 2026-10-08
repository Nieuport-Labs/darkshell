import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'cash.darkshell.wallet',
	appName: 'DarkShell',
	webDir: 'dist',
	backgroundColor: '#080808',
	plugins: {
		// light status/navigation bar icons on the dark UI; safe-area insets as CSS vars
		SystemBars: { style: 'DARK', insetsHandling: 'css' },
		LocalNotifications: { smallIcon: 'ic_stat_notify', iconColor: '#ff3912' },
	},
	android: {
		// no remote debugging in release builds
		webContentsDebuggingEnabled: false,
	},
};

export default config;
