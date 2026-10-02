# Belong for Android

Native Android app in Kotlin that uses only the Android framework (no AndroidX), minSdk 26 (Android 8.0). The UI is in English, Ukrainian and Russian, and the example couple is Yulia and Igor. The look follows the Belong design system: her pink, his blue, and the gradient where they meet (“two colours that become one”).

## What's inside

Five tabs: Today, Dreams, Chat, Photos, Us.

- **Today:**
  - **customise it**: “Customise Today” at the bottom shows and hides cards and moves them up or down (saved per phone; “Back to the original layout” resets). Notices — a letter that opened, a feelings note waiting, the month report — always come first;
  - **our photo**: a cover photo of the two of you with “Together for N days”, shared by both phones (tap to change or remove);
  - **notes for each other**: a short note each of you leaves for the other, shown until it's replaced;
  - **on this day**: photos of the day and memories from this date a year or more ago;
  - “Thinking of you”, “I'm safe” and “Send support” now sit in the partner's card; after you check in, your mood folds into one line (tap to change); the widgets card hides once a widget is on the home screen;
  - greeting, the partner's mood and energy, and your own check-in;
  - **plan for the day**: mine, ours and the partner's tasks. Tap to tick off, long-press to delete. Unfinished tasks roll over to the next day;
  - **together or apart**: on first launch Today asks whether you live together or apart (also in Settings). Apart: both cities' clocks, the distance and the countdown to your next meeting. Together: the next important dates from the calendar instead;
  - **photo of the day**: today's photos from both of you; a card announces last month's report in the first week of a month;
  - when your partner has written about their feelings, a card invites you to write your side;
  - the “Thinking of you” and “I'm safe” buttons and buttons to place widgets.
- **On Today** also:
  - **Shopping**: a shared list showing who added each item;
  - **Question of the day**: the same question on both phones; your partner's answer stays blurred (and the server won't send it) until you answer too;
  - **End of the day**: in the evening, a short “thank you” for your partner, with suggestion chips; they see it the next morning.
- **Us** (replaces More): how long you've been together, the **chronicle** (dreams that came true, goals reached, your own memories with an optional photo, “On this day”), the weekly quiz **“How well do you know me?”** (guess your partner's answers, give your own, compare once both have played) and everything that was under More.
- **Dreams** (from the design handoff):
  - the **wish map**: dreams with a picture, a category and whose they are (mine, ours, the partner's); filter by category; “Me too 💞” turns the partner's dream into a shared one;
  - **goals**: “Make it a goal” turns a dream into a goal with a progress ring, a **savings jar** (each partner's share in their colour, and when you'll get there at the current pace) and **steps** with who does them and by when; a step can go to today's plan; “We did it” marks the dream as come true;
  - **Matches**: swipe date and life ideas (no / maybe / yes); you only ever see what you both said yes to, then “It's a match!” lets you plan it or put it on the map;
  - **photos**: while you type a dream's title, the app suggests Unsplash photos for it (credited to the photographer, as Unsplash requires); the dream card and the goal cover show the chosen one;
  - **“Share” from Pinterest** (or a browser): pick “Save as a dream” in the share menu, and the pin's title and picture fill in a new dream;
  - the gift **wishlist** opens from here and from More.
- **Chat:**
  - messages grouped by day;
  - **photos** (compressed like photos of the day; tap to open full screen) and **voice messages** (tap the microphone when nothing is typed; up to 2 minutes, AAC 24 kbps; needs microphone access);
  - a long press puts ❤️ on a message;
  - the heart button sends “Thinking of you” and counts towards the month.
- **Wishlist:**
  - your list: add and edit gifts, trips and experiences with a price, a link and a note. Only http(s) links open;
  - your partner's list: mark “I'll give this” and they won't see that it's reserved.
- **Photos:** each of you adds up to 5 photos a day (from the gallery, with an optional caption). They're grouped by day, filter by whose they are, open full screen, and your own can be deleted. Photos are compressed on the phone (1280 px, plus a 360 px thumbnail) and stored in the pair's database, which keeps them within the free Spark plan.
- **Important dates** (Us → Important dates): a month calendar with dots, what's coming up (birthdays with the age, your anniversary, plans; yearly or once) and, for a couple apart, the meeting.
- **Our month / Our year** (Us): a report for any month or year with a collage of your photos of the day, taps, doodles, mood, questions answered together, evening notes, dreams that came true, goals and memories. Distance, time zones and the meeting only for a couple apart. The story card shows up to three photos as polaroids.
- **Open when…** (Us): letters for later, either on a day (“Open on our anniversary”) or for a moment (“Open when you're sad”). The database itself keeps a dated letter unreadable until its day; the writer sees when it has been read. A card on Today says when a letter has opened.
- **Films and series** (Us): a shared to-watch list (who suggested what), “What shall we watch tonight?” picks one at random, and watched titles get each partner's own stars (the partner's stars show once you've given yours) and your average. Films watched count in the month report.
  - **TMDB catalog** (the “Discover ✨” tab): search, popular this week, best films and series, genres; posters, years and descriptions in the app's language. Adding a title searches TMDB as you type.
  - **For the two of you:** suggestions from both partners' stars. Each rating moves its genres up or down for whoever gave it; titles come from TMDB's “more like this” for what either of you rated 4–5 stars and from genres you both like. A title scores by how well it suits the one of you it suits least, so the top is what you'd both enjoy, with a reason (“You both liked …”). “Not for us” hides a title on this phone.
  - The TMDB API key is in `res/values/cloud.xml` (`tmdb_api_key`). The app credits TMDB as its terms require.
- **Talking about feelings** (Us): after a quarrel each of you writes what happened, what you feel, what you need and what you'd ask for. Your partner's note opens only once you've written yours (the database enforces it).
- **Places** (Us → Places):
  - an offline world map (Natural Earth land outlines);
  - photos from the gallery appear where they were taken, read from the GPS data inside each photo;
  - pinch, double-tap or use the +/− buttons to zoom. Markers merge when they overlap and show the newest photo with a count;
  - tapping a marker or a place in the list opens its photos.

  Needs access to photos. On Android 10+ it also needs photo-location access: without it Android hides the location. Locations never leave the phone. The newest 3,000 photos are scanned and cached, so a rescan is quick. Until access is granted the map shows example places.
- **More:**
  - **Doodle:** draw and send. The partner's latest doodle appears on the home-screen widget;
  - **Games:** Date Match on one phone and the date wheel;
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
- **doodles**: the partner's latest doodle reaches the doodle screen and the home-screen widget;
- **dreams and goals**, including money added on both phones at once (the server adds the amounts up);
- **Matches** answers, kept so that neither partner can see the other's no or maybe.

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
