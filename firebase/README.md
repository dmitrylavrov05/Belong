# Belong server (Firebase)

The Android app pairs two phones and syncs the chat through a Firebase project.
It talks to Firebase over REST, so the app has no Firebase SDK and no `google-services.json`.
The free Spark plan is enough: there are no Cloud Functions.

## How pairing works

- **Create.** Partner A signs up as `<code>.a.1@pair.belong.app` with their own password and claims seat `a` of `pairs/<code>`.
- **Join.** Partner B enters the code and signs up as `<code>.b.1@pair.belong.app`. Seat `b` can be claimed only once.
- **Sign in.** The app reads the public `pairs/<code>/logins` (names and account generation), then signs in with the code, the seat and the password.
- **Forgotten password.** The other partner writes a one-time help code to `pairs/<code>/reset/<seat>`. The person who forgot signs up a new account `<code>.<seat>.<gen+1>@…` and moves the seat to it by proving the help code. The code works once, for 30 minutes. The old account loses access.

Nobody receives mail at `pair.belong.app`: the address is just an account name. `database.rules.json` enforces all of the above. Members alone read the pair. Messages can't be forged, edited or deleted; the other partner can only add a ❤️.

## Set up a project

1. Create a project at <https://console.firebase.google.com> (Google Analytics is not needed).
2. **Authentication → Sign-in method:** enable **Email/Password**.
3. **Realtime Database → Create database.** Pick a location and start in locked mode.
4. Deploy the rules:

   ```bash
   npm install -g firebase-tools
   firebase login
   cd firebase
   firebase use --add          # pick the project
   firebase deploy --only database
   ```

5. Put the project's details into `android/app/src/main/res/values/cloud.xml`:
   - `cloud_api_key`: **Project settings → General → Web API key**;
   - `cloud_database_url`: the URL at the top of the **Realtime Database** page, for example `https://belong-123-default-rtdb.europe-west1.firebasedatabase.app`.

   While both are empty the app runs in demo mode, as before.

## Test against the emulators

```bash
cd firebase
firebase emulators:exec --project demo-belong --only auth,database "cd ../android && ./gradlew test"
```

`CloudEmulatorTest` then runs pairing, the live chat stream and password recovery against these rules. Without the emulators it is skipped.
