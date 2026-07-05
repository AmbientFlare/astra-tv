# Astra Amazon Appstore Submission Packet

Date: 2026-07-05
Release target: v0.5 review / app version 0.1.0
Package ID: com.astra.tv
Main component: com.astra.tv.main

## Submission Files

Fresh release VPKGs are local-only because `dist/` is gitignored:

- `dist/amazon-submission-0.1.0-20260705/astra-0.1.0-aarch64-release.vpkg`
- `dist/amazon-submission-0.1.0-20260705/astra-0.1.0-armv7-release.vpkg`
- `dist/amazon-submission-0.1.0-20260705/astra-0.1.0-x86_64-release.vpkg`
- `dist/amazon-submission-0.1.0-20260705/SHA256SUMS.txt`

Build command used:

```sh
KEPLER_SDK_PATH=/home/levi/vega/sdk/0.23.8358 \
PATH=/home/levi/vega/bin:/home/levi/vega/sdk/0.23.8358/bin:$PATH \
npm run build:release
```

Verification completed:

- `manifest.toml` validates with 0 errors.
- `npm run build:release` passes.
- `npm run lint` passes.
- `npm test -- --watchAll=false` passes.

## Amazon Requirements Snapshot

Sources checked:

- Vega app submission: https://developer.amazon.com/docs/vega/0.22/app-submission.html
- Appstore details / Fire TV assets: https://developer.amazon.com/docs/app-submission/appstore-details.html
- Target app / privacy / audience sections: https://developer.amazon.com/docs/app-submission/target-app.html
- Update/version guidance: https://developer.amazon.com/docs/app-submission/update-published-app.html

Key requirements:

- Upload VPKG binary file(s).
- Maintain Vega build numbers across updates; future updates need a greater VPKG build number.
- Provide Fire TV App Icon: 1280 x 720 PNG, no transparency.
- Provide Fire TV screenshots: 3 to 10 images, 1920 x 1080 landscape, JPG or 24-bit PNG, no transparency.
- Provide Fire TV Background Image: 1920 x 1080 landscape, JPG or 24-bit PNG, no transparency.
- Complete supported devices, availability, target audience, content rating, and user data privacy.
- Do not show personal information in screenshots; use dummy server/account data.

## Step 1: Upload Your App File

Upload:

- Primary: `astra-0.1.0-aarch64-release.vpkg`
- Also upload if the console accepts separate architecture binaries:
  - `astra-0.1.0-armv7-release.vpkg`
  - `astra-0.1.0-x86_64-release.vpkg`

Release notes:

```text
Initial public preview for Fire TV devices running Vega OS.

Astra connects to a Jellyfin media server, discovers local servers, saves server profiles, browses movie and TV libraries, supports search, shows media details, resumes playback, reports watch progress, and plays compatible media through the Vega media stack with Jellyfin transcode fallback.

This release focuses on core Jellyfin playback and living-room navigation. Additional backend support and deeper customization are planned for later releases.
```

## Step 2: Target Your App

Supported devices:

```text
Fire TV devices running Vega OS.
```

Availability:

```text
United States
```

Recommended first submission choice:

```text
US only for v0.5 review, then expand after approval and more device testing.
```

Target audience:

```text
General audience / users who operate their own personal media server.
```

Content rating:

```text
Astra itself contains no media catalog and no first-party video content. It is a media client. Content shown in the app is supplied by the user's own Jellyfin server and may vary by user.
```

User data privacy summary:

```text
Astra stores media-server connection profiles locally on the device, including server URL, username, user ID, access token, app preferences, display preferences, and playback preferences. Astra uses this data only to connect to the user's chosen media server and provide playback/browsing features. Astra does not operate a hosted backend, does not sell user data, does not include advertising, and does not send personal data to the developer's servers.
```

User account and deletion:

```text
Users can remove saved server profiles and sign out from inside Settings > Login > Manage servers. This clears stored account access for Astra on the device. Actual media-server accounts and libraries are managed by the user's Jellyfin server administrator outside Astra.
```

Network / permissions rationale:

```text
Astra requests network access to connect to user-provided Jellyfin servers and to discover local media servers on the user's home network. Astra requests network information access to derive local subnet prefixes for server discovery.
```

## Step 3: Appstore Details

App title:

```text
Astra
```

Short description:

```text
Stream your personal media library on Fire TV.
```

Long description:

```text
Astra is a media client for Fire TV devices running Amazon Vega OS. It is built for people who keep movies, shows, and videos on a personal media server and want a clean living-room interface for watching them from the couch.

The first supported backend is Jellyfin. Astra lets you connect to your server, browse your libraries, search your media, view movie and episode details, resume where you left off, and start playback quickly with a TV remote.

For movie and TV libraries, Astra includes home rows for Continue Watching, Next Up, latest movies, and latest shows. Library screens use a remote-friendly grid with poster art and metadata. Detail screens show overview text, genres, ratings, runtime, people, chapters, resume state, and watched/favorite controls where supported by the server.

Playback is built around the Vega media stack and Jellyfin playback information. Astra supports HLS playback, Jellyfin stream-copy and transcode fallback, audio track selection, subtitle selection, quality controls, progress reporting, resume reporting, and chapter navigation.

Astra is different from subscription streaming services because it is centered on your own server and your own media library. There is no bundled catalog, no monthly subscription required by Astra, and no recommendation system pushing third-party content. You choose the server, you manage the content, and Astra gives it a Fire TV interface.

Astra is free and open source under the GPL-3.0 license. Optional support features may be added later to help fund development, but the core media client is intended to remain free.
```

Keywords:

```text
jellyfin, media server, personal media, home server, self hosted, streaming, fire tv player
```

Category:

```text
Entertainment
```

Support email:

```text
levi@ambientflare.art
```

Support URL:

```text
https://github.com/wangdangel/astra-tv
```

Website URL:

```text
https://github.com/wangdangel/astra-tv
```

Privacy policy URL:

```text
TODO before submission: create a simple privacy policy page.
```

Suggested privacy policy copy:

```text
Astra is a Fire TV media client for user-managed media servers. Astra stores server connection profiles and playback preferences locally on the user's device. Saved profile data may include server URL, username, user ID, access token, selected preferences, and playback settings. Astra uses this information only to connect to the user's selected server and provide browsing/playback features.

Astra does not operate a hosted service for user media, does not sell user data, does not include third-party advertising, and does not transmit personal data to the developer's servers. Media metadata, artwork, playback URLs, and playback progress are exchanged directly between the Astra app and the user's configured media server.

Users can remove saved server profiles and clear access tokens in the app settings. Deleting an account or media library on the server must be handled by the user's server administrator.
```

## Required Image Assets

Still needed before submission:

- App Icon: 1280 x 720 PNG, no transparency.
- Screenshots: minimum 3, maximum 10, 1920 x 1080 landscape JPG or 24-bit PNG, no transparency.
- Background Image: 1920 x 1080 landscape JPG or 24-bit PNG, no transparency.

Recommended screenshot set:

1. Setup screen with blank/dummy server fields or discovered dummy server.
2. Home screen showing library rows.
3. Movie library grid.
4. Movie detail screen.
5. Player with controls visible.
6. Settings / playback preferences.

Screenshot rules:

- Use dummy account/server data.
- Do not show Levi's real server URL, username, watch history, access tokens, or personal library metadata if privacy matters.
- Show the TV app itself, not a photo of a TV.
- Use different scenes that show the main user flow.

Current blocker:

```text
The connected Fire TV is visible to Vega CLI, but this SDK install does not expose `gwsi-tool-screenshooter`, which Amazon references for Vega screenshots. Screenshots may need to be captured manually or through another SDK/device tool.
```

## Reviewer Notes

Use this in the review notes / testing instructions field:

```text
Astra is a client for user-managed Jellyfin media servers. The app does not include built-in media content. To test the app, reviewers need access to a Jellyfin server with at least one movie or episode library.

Test flow:
1. Launch Astra.
2. Enter a Jellyfin server URL, username, and password, or select a discovered server if one is available on the local network.
3. Browse libraries from the Home screen.
4. Open a movie or episode detail screen.
5. Start playback.
6. Use the Fire TV remote for pause/play, seek, back, menu, audio/subtitle controls, and settings.

Astra stores server profiles locally on the device. Users can sign out or remove saved server profiles from Settings > Login > Manage servers.

If a review test account is required, provide a temporary Jellyfin server URL and credentials separately in the secure reviewer credentials field.
```

Do not include Levi's personal Jellyfin credentials in public app metadata.

## Known v0.5 Limitations To Avoid Overclaiming

- Jellyfin is the first supported backend.
- Emby/Kodi are planned, not complete.
- The app does not provide a media catalog or hosted streaming content.
- Screenshots and review account should use dummy/test media.
- Some server-side playback behavior depends on the user's Jellyfin transcoding setup.

## Final Pre-Submit Checklist

- [x] Release VPKGs built.
- [x] Manifest validates.
- [x] Lint passes.
- [x] Tests pass.
- [x] Dev credentials removed from app defaults.
- [x] Playback URL logs redact tokens.
- [x] Network info privilege declared in `manifest.toml`.
- [ ] Create privacy policy URL.
- [ ] Capture 3-10 real 1920 x 1080 screenshots with dummy/non-private content.
- [ ] Create 1280 x 720 Fire TV app icon.
- [ ] Create 1920 x 1080 Fire TV background image.
- [ ] Decide whether to provide a temporary reviewer Jellyfin account.
- [ ] Upload VPKG(s) and complete Amazon Developer Console fields.
