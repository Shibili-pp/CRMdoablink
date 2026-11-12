# DoablinkOrbit Android app

Staff install this app on their own Android phone. It reads that phone's call log and sends the number, time and duration to the CRM. It does not upload call recordings. A browser cannot do this.

The install file is `dist/DoablinkOrbit.apk`. It is signed with `release.jks`. Keep `release.jks` and `keystore.properties`. A later update must use the same key or phones will refuse to install it.

## Install on a phone

1. Copy `DoablinkOrbit.apk` to the phone.
2. Open it and allow installation from this source when Android asks.
3. Sign in with the staff username and the CRM address, including `/api/v1`.
4. Allow call history.
5. Tap Allow background sync so the phone keeps sending calls after the screen turns off.

Calls then appear in Calling Analytics and Hourly Reports as Android sync. Each phone is tied to the staff member who signed in.

## Build again

Open this folder in Android Studio, or from `android/` run `gradlew.bat assembleRelease`. The SDK path belongs in `local.properties`.
