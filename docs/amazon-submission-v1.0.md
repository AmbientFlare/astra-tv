# Astra Amazon Appstore Submission Packet

Date: 2026-07-05
Release target: v1.0 review / app version 1.0.0
Package ID: com.astra.tv
Main component: com.astra.tv.main

## Submission Files

Fresh release VPKGs are local-only because `dist/` is gitignored:

- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-aarch64-release.vpkg`
- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-armv7-release.vpkg`
- `dist/amazon-submission-1.0.0-20260705/astra-1.0.0-x86_64-release.vpkg`
- `dist/amazon-submission-1.0.0-20260705/SHA256SUMS.txt`

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

- Primary current Fire TV target: `astra-1.0.0-x86_64-release.vpkg`
- Additional local builds exist for future hardware coverage:
  - `astra-1.0.0-aarch64-release.vpkg`
  - `astra-1.0.0-armv7-release.vpkg`

Amazon console behavior observed on 2026-07-05:

- `x86_64` mapped to supported Fire TV Vega devices.
- `aarch64` and `armv7` mapped to 0 currently supported devices.
- If multiple VPKGs are uploaded into the same version, Amazon requires unique
  build numbers for each uploaded file.

1.0.0 build numbers:

- `aarch64`: `202607051`
- `armv7`: `202607052`
- `x86_64`: `202607053`

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
US only for v1.0 review, then expand after approval and more device testing.
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
Astra is a Fire TV media client for Jellyfin, designed for people who host their own movie and TV libraries and want a clean, remote-friendly way to watch them on the big screen.

Connect Astra to your Jellyfin server, sign in with your own account, and browse your personal media collection from Fire TV. Astra supports local network Jellyfin servers running at home over HTTP, as well as remote Jellyfin servers over HTTPS.

Astra is built around TV use. The interface is designed for couch navigation with a Fire TV remote, with large artwork, focused rows, clear menus, and playback controls that feel natural on a television. It is intended to make your Jellyfin library feel at home on Fire TV.

You can browse your libraries, view movies and series, explore seasons and episodes, search your server, resume in-progress videos, and open detailed pages with artwork, descriptions, runtime, release year, ratings, genres, cast, and related information when available from your Jellyfin server.

Astra is for users who already run Jellyfin or plan to set up their own Jellyfin server. It does not include a media service, subscription, hosted catalog, or public streaming channels. Your library, accounts, metadata, and playback options come from the Jellyfin server you connect to.

Astra does not provide, sell, rent, stream, host, or include any movies, shows, channels, subscriptions, or live content. All media shown in Astra comes from your own Jellyfin server. You are responsible for your own server, media files, accounts, network configuration, and content rights.

Astra is an independent client application and is not affiliated with, endorsed by, or sponsored by Jellyfin, Amazon, or any content provider. Jellyfin is a trademark of its respective owners.
```

Keywords:

```text
jellyfin, media server, home media, movie library, tv library, video player, media player, home theater, self hosted media, personal streaming, local media, private media, jellyfin client, media center, fire tv media, network media, nas media, resume playback
```

Category:

```text
Movies & TV / Video Streaming
```

Support email:

```text
levi@ambientflare.art
```

Support URL:

```text
https://watchastra.com
```

Website URL:

```text
https://watchastra.com
```

Privacy policy URL:

```text
TODO: add the final hosted privacy policy URL used in Amazon Developer Console.
```

Suggested privacy policy copy:

```text
Astra is a Fire TV media client for user-managed media servers. Astra stores server connection profiles and playback preferences locally on the user's device. Saved profile data may include server URL, username, user ID, access token, selected preferences, and playback settings. Astra uses this information only to connect to the user's selected server and provide browsing/playback features.

Astra does not operate a hosted service for user media, does not sell user data, does not include third-party advertising, and does not transmit personal data to the developer's servers. Media metadata, artwork, playback URLs, and playback progress are exchanged directly between the Astra app and the user's configured media server.

Users can remove saved server profiles and clear access tokens in the app settings. Deleting an account or media library on the server must be handled by the user's server administrator.
```

## Required Image Assets

Fire TV listing assets are in:

- `dist/amazon-submission-1.0.0-20260705/assets/astra-fire-tv-icon-1280x720.png`
- `dist/amazon-submission-1.0.0-20260705/assets/astra-fire-tv-background-1920x1080.png`
- `dist/amazon-submission-1.0.0-20260705/screenshots/`

Tablet fallback assets requested by the Amazon console are in:

- `dist/amazon-submission-1.0.0-20260705/tablet-assets/icons/astra-tablet-large-icon-512x512.png`
- `dist/amazon-submission-1.0.0-20260705/tablet-assets/icons/astra-tablet-small-icon-114x114.png`
- `dist/amazon-submission-1.0.0-20260705/tablet-assets/screenshots/`

Final Fire TV screenshot set:

1. `01-setup-connect-server.png`
2. `02-home-library-rows.png`
3. `03-shows-library-grid.png`
4. `04-movie-detail-cast.png`
5. `05-series-detail-seasons.png`
6. `06-episode-detail-next-up.png`
7. `07-playback-settings.png`
8. `08-preferences.png`
9. `09-login-settings.png`
10. `10-about.png`

## Reviewer Notes

Use this in the review notes / testing instructions field:

```text
Astra requires a Jellyfin server account for review. Please use the test account below.

Server URL:
https://jelly2.ambientflare.art

Username:
Provided in the secure Amazon reviewer credentials field.

Password:
Provided in the secure Amazon reviewer credentials field.

Login steps:
1. Launch Astra.
2. Enter the server URL above when prompted.
3. Sign in with the username and password above.
4. After login, the app will open to the available media libraries.

Astra is a client for user-provided Jellyfin media servers. It is intended for users to access their own media libraries from servers they control, including local network, VPN, or remote HTTPS configurations.
```

Do not include reviewer credentials in public app metadata or committed docs.

## Known v1.0 Limitations To Avoid Overclaiming

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
- [ ] Create/privacy-policy URL and add it to Amazon Developer Console.
- [x] Capture 3-10 real 1920 x 1080 screenshots.
- [x] Create 1280 x 720 Fire TV app icon.
- [x] Create 1920 x 1080 Fire TV background image.
- [x] Stage tablet fallback icon/screenshot assets requested by console.
- [x] Provide a temporary reviewer Jellyfin account.
- [ ] Upload final VPKG and complete Amazon Developer Console fields.
