# Belong for Android

Native Android app in Kotlin that uses only the Android framework (no AndroidX), minSdk 26 (Android 8.0). The UI is in English and Ukrainian, and the example couple is Yulia and Igor.

## What's inside

- **Today:** greeting, the partner's mood and energy, your own check-in, both cities' clocks, the distance between you, the countdown to your next meeting, and the “Thinking of you” and “I'm safe” buttons.
- **Doodle:** draw with your finger and send the drawing. The partner's latest doodle appears in the app and on the home-screen widget.
- **Games:** Date Match on one phone (each of you swipes 10 ideas, then you see only the mutual yeses) and the date wheel with budget and place filters.
- **Month:** “Our month apart”. Shows km between you, time difference, “thinking of you” taps, doodles, “I'm safe” check-ins, days until you meet and average mood. Exports a 1080×1920 story card you can share or save to the gallery (Android 10+).
- **Home-screen widgets:**
  - **Mood:** the partner's mood, energy, and live local time.
  - **Countdown:** days until you meet.
  - **Doodles:** the partner's latest drawing.

  The Today screen can place them with one tap where the launcher supports it. The widgets also declare the lock-screen (keyguard) category, but most Android phones only allow widgets on the home screen.
- **Settings:** names, cities and the meeting date.

**Demo mode.** There is no sync server yet. Everything is stored on the phone, and the partner is simulated. Igor answers some “thinking of you” taps and sends a doodle back a few seconds after you send one, so you can see the widgets update. The Month screen marks its numbers as an example.

## Build in Android Studio or CI

Open this folder in Android Studio, or run:

```bash
./gradlew test assembleDebug     # APK in app/build/outputs/apk/debug/
```

`.github/workflows/android.yml` does the same on GitHub and uploads the APK as an artifact.

## Build without the Android Gradle Plugin

`sandbox/` builds the same sources where Google's Maven repository and SDK downloads are unavailable. It uses:

- aapt2, zipalign and apksigner from Ubuntu packages;
- `android-34.jar` (platform API);
- D8 from `r8lib.jar`.

```bash
sudo apt-get install aapt zipalign apksigner zip
mkdir -p /opt/android-sandbox
curl -o /opt/android-sandbox/android-34.jar https://raw.githubusercontent.com/Sable/android-platforms/master/android-34/android.jar
curl -o /opt/android-sandbox/r8lib.jar https://storage.googleapis.com/r8-releases/raw/8.5.35/r8lib.jar
cd sandbox
gradle test             # unit tests
gradle assembleApk      # signed debug APK: build/outputs/belong-debug.apk
gradle compileKotlin -PapiCheck=26   # lists calls that need an Android version check
```

The sandbox APK targets API 34, because the Ubuntu build of aapt2 cannot read the API 35 resource table. The Android Studio build targets API 35. The sandbox signs with a debug key created in `sandbox/build/`, so an APK from a fresh checkout has a different signature: uninstall the old one before installing it.

## Fonts

Manrope by The Manrope Project Authors, SIL Open Font License 1.1 (`app/src/main/assets/licenses/OFL-Manrope.txt`).
