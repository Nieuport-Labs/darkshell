#!/usr/bin/env bash
# Builds the signed release APK: web build → Capacitor sync → Gradle.
# Needs the Android SDK (android/local.properties) and JDK 21 (Android Studio's jbr).
set -euo pipefail
cd "$(dirname "$0")"
# Capacitor 8 needs JDK 21; prefer Android Studio's bundled one
JBR="/c/Program Files/Android/Android Studio/jbr"
[ -x "$JBR/bin/java" ] && export JAVA_HOME="$JBR"
CAPACITOR=1 npx vite build
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon -q)
mkdir -p ../release
out=android/app/build/outputs/apk/release
# all phones (larger: Tor for every ABI) and the usual modern phone (arm64)
cp "$out/app-universal-release.apk" ../release/DarkShell.apk
cp "$out/app-arm64-v8a-release.apk" ../release/DarkShell-arm64.apk
echo "→ release/DarkShell.apk (all phones), release/DarkShell-arm64.apk (most phones)"
