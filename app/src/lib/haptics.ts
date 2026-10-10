// Short vibrations that go with the motion: a tap, a landed transaction, a
// refusal. The WebView's Vibration API (android VIBRATE permission); silent
// where there is none.

function buzz(pattern: number | number[]): void {
	try {
		navigator.vibrate?.(pattern);
	} catch {
		/* not allowed here */
	}
}

export const haptic = {
	tap: () => buzz(8),
	/** a swipe or a confirm that sends something */
	commit: () => buzz(18),
	/** it landed: two soft knocks */
	success: () => buzz([14, 70, 26]),
	error: () => buzz([40, 60, 40]),
};
