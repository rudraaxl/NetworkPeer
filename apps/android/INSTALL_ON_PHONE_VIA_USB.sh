#!/bin/bash
set -e

export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
export ANDROID_HOME="/Users/adityasharma/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"

echo "========================================================"
echo "   NetworkPeer — Kotlin Android USB Installer         "
echo "========================================================"
echo ""
echo "Checking connected Android device via ADB..."
DEVICES=$(adb devices | grep -v "List" | grep "device$" || true)

if [ -z "$DEVICES" ]; then
  echo "❌ No authorized Android device detected via USB!"
  echo ""
  echo "Please check the following on your phone:"
  echo " 1. Connect phone to Mac using a USB data cable."
  echo " 2. Enable Developer Options: Settings > About Phone > Tap 'Build Number' 7 times."
  echo " 3. Enable USB Debugging: Settings > Developer Options > USB Debugging = ON."
  echo " 4. Unlock your phone and tap 'Allow USB Debugging' when prompted."
  echo ""
  echo "Current ADB status:"
  adb devices
  exit 1
fi

echo "✅ Device detected:"
echo "$DEVICES"
echo ""

APK_PATH="$(dirname "$0")/NetworkPeer-Worker.apk"
if [ ! -f "$APK_PATH" ]; then
  APK_PATH="$(dirname "$0")/app/build/outputs/apk/development/debug/app-development-debug.apk"
fi

if [ -f "$APK_PATH" ]; then
  echo "📦 Installing APK directly to connected device..."
  adb install -r -d "$APK_PATH"
else
  echo "🔨 Building and installing via Gradle..."
  cd "$(dirname "$0")"
  ./gradlew installDevelopmentDebug
fi

echo ""
echo "🚀 Launching NetworkPeer on your phone..."
adb shell am start -n com.networkpeer.mobile.dev/com.networkpeer.mobile.MainActivity

echo ""
echo "========================================================"
echo "🎉 App installed and launched successfully!"
echo "Connected to the API configured for this build:"
echo "  see NETWORKPEER_API_BASE_URL in apps/android/networkpeer.development.local.properties"
echo "========================================================"
