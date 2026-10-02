# Belong for Android

Native Android app in Kotlin that uses only the Android framework (no AndroidX), minSdk 26 (Android 8.0). The UI is in English, Ukrainian and Russian, and the example couple is Yulia and Igor. The look follows the Belong design system: her pink, his blue, and the gradient where they meet (“two colours that become one”).

## What's inside

Five tabs: Today, Chat, Wishlist, Places, More.

- **Today:**
  - greeting, the partner's mood and energy, and your own check-in;
  - **plan for the day**: mine, ours and the partner's tasks. Tap to tick off, long-press to delete. Unfinished tasks roll over to the next day;
  - both cities' clocks, the distance between you and the countdown to your next meeting;
  - the “Thinking of you” and “I'm safe” buttons and buttons to place widgets.
- **Chat:**
  - messages grouped by day;
  - a long press puts ❤️ on a message;
  - the heart button sends “Thinking of you” and counts towards the month.
- **Wishlist:**
  - your list: add and edit gifts, trips and experiences with a price, a link and a note. Only http(s) links open;
  - your partner's list: mark “I'll give this” and they won't see that it's reserved.
- **Places:**
  - an offline world map (Natural Earth land outlines);
  - photos from the gallery appear where they were taken, read from the GPS data inside each photo;
  - pinch, double-tap or use the +/− buttons to zoom. Markers merge when they overlap and show the newest photo with a count;
  - tapping a marker or a place in the list opens its photos.

  Needs access to photos. On Android 10+ it also needs photo-location access: without it Android hides the location. Locations never leave the phone. The newest 3,000 photos are scanned and cached, so a rescan is quick. Until access is granted the map shows example places.
- **More:**
  - **Doodle:** draw and send. The partner's latest doodle appears on the home-screen widget;
  - **Games:** Date Match on one phone and the date wheel;
  - **Our month apart:** a story card you can share or save;
  - **Settings:** names, a **pet name for your partner** (Sunshine ☀️, Котик 🐱, … shown everywhere instead of the name), cities, the meeting date and the **app language** (phone’s language, English, Українська or Русский; on Android 13+ it is also in the system’s per-app language settings).
- **Home-screen widgets:**
  - partner's mood with live local time;
  - countdown to your meeting;
  - partner's latest doodle;
  - **today's tasks** (tap a row to tick it off without opening the app).

  The widgets also declare the lock-screen (keyguard) category, but most Android phones only allow widgets on the home screen.

**Pairing and sync.** There is no Google or email sign-in:

- one partner taps **Create a pair**, picks a password and gets a code like `K7M3-Q9XP`;
- the other taps **I have a code**, enters it and picks their own password;
- on a new phone you **Sign in** with the code, then choose who you are and enter your password;
- a forgotten password is replaced with a one-time code from your partner (More → Our pair → Help sign in). It works once, for 30 minutes, and the old phone is signed out.

Synced between the two phones:

- **chat**, including ❤️ on messages;
- **Today**: both mood and energy check-ins, “thinking of you”, “I’m safe” and “send support” taps (the partner sees a toast) with this month’s counts, and the shared plan for the day;
- **wishlists**: each partner edits their own list. “I'll give this” is stored in a part of the server only the reserver can read, so the owner can't find out even with a modified app;
- **doodles**: the partner's latest doodle reaches the doodle screen and the home-screen widget.

All of it works offline: changes are saved on the phone first and sent on the next connection. There are no push notifications yet: updates arrive while the app is open.

The server is a Firebase project used over REST (no Firebase SDK); see [`../firebase/README.md`](../firebase/README.md). Its details go into `app/src/main/res/values/cloud.xml`.

**Demo mode.** While `cloud.xml` is empty, or after **Just look around**, the partner is simulated:

- Igor replies in chat after a few seconds (“typing…” first);
- he answers some “thinking of you” taps;
- he sends a doodle back after you send one;
- his wishlist and tasks are example data.

## Build in Android Studio or CI

Open this folder in Android Studio, or run:

```bash
./gradlew test assembleDebug     # APK in app/build/outputs/apk/debug/
```

`.github/workflows/android.yml` does the same on GitHub with the Firebase emulators running, so the server rules are tested too, and uploads the APK as an artifact.

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

## Third-party assets

- Manrope by The Manrope Project Authors, SIL Open Font License 1.1 (`app/src/main/assets/licenses/OFL-Manrope.txt`).
- World map: Natural Earth land polygons, public domain. `tools/make_world_map.py` converts them into `app/src/main/assets/map/*.bin`.
