# iOS App Store Release

## Fast commands

```bash
npm run ios:prep-store
npm run ios:open
```

`ios:prep-store` builds the React app, syncs it into the Capacitor iOS project, and runs the App Store preflight checks.

## What still happens in Xcode and App Store Connect

1. Open the iOS project in Xcode.
2. Set the final bundle identifier and signing team.
3. Archive the app from Xcode.
4. Upload the archive to App Store Connect.
5. Fill in screenshots, app metadata, privacy policy URL, and App Privacy answers.
6. Distribute first through TestFlight, then submit for App Review.

## Important release note

This app is meant for a vertical iPhone layout, so the iPhone target is set to portrait only in `Info.plist`.

## Preflight focus areas

- Bundle ID and app name
- Marketing version and build number
- Portrait-only iPhone orientation
- iPhone-only target family
- Presence of app icon assets
- Any lingering `localhost` references in source or built assets that would break on real customer devices

## Submission guidance

- The current shipped app does not require a backend. Keep release builds free of `localhost` dependencies unless a production service is intentionally added later.
- Because this app stores health-adjacent personal tracking data, prepare a real privacy policy URL and make sure App Privacy answers match what is stored locally and exported.
- Avoid medical claims in App Store metadata. Position the app as a personal tracking tool, not medical advice or treatment guidance.
- Test the final release archive on a real iPhone through TestFlight before submission, especially file import/export and share flows.
