# Astra manual smoke tests

A pass/fail matrix to run before shipping a build. Every step is
action → expected result. A step passes only if you saw the expected
result; "probably works" is a fail.

Run the whole matrix against **both** profiles below. The two servers check
different things: one has many libraries whose items resolve when playback is
requested, the other is the everyday library of local files that existing
users actually watch.

| Profile | Server URL | What it exercises |
|---|---|---|
| **Test unit** | `<test-server>` | Many libraries, items that resolve at playback time, series whose season tree is built while browsing |
| **Production** | `<production-server>` | Local files, real users, resume positions, music |

## Before you start

Fill in the three values this matrix refers to. They describe one particular
bench rather than the app, so they are kept out of the repository:

| Placeholder | What it is | Where to find it |
|---|---|---|
| `<test-server>` | Base URL of the server with many libraries | Your local operator notes |
| `<production-server>` | Base URL of the everyday library | Your local operator notes |
| `<device-serial>` | Serial of the TV device under test | `~/vega/bin/vega device list` |

Install and launch the build:

```bash
VPKG=build/private/kepler/@amazon-devices/astra/undefined/vega/x86_64/Release/@amazon-devices/astra_x86_64.vpkg
~/vega/bin/vega device -d <device-serial> install-app --packagePath "$VPKG"
~/vega/bin/vega device -d <device-serial> launch-app --appName com.astra.tv.main
```

`install-app` updates in place and keeps signed-in profiles. Record the build
number you tested, and note which profile each result belongs to.

---

## 1. Sign-in and profiles

| # | Action | Expected result |
|---|---|---|
| 1.1 | Launch the app with no saved profile | The setup wizard appears, not the home screen |
| 1.2 | Enter the server URL for the profile under test and continue | The server is found and sign-in options appear |
| 1.3 | Sign in with username and password | The home screen appears with your username on the top-left button |
| 1.4 | Press the top-left username button | The "Who's watching?" overlay lists the signed-in profiles |
| 1.5 | Pick another profile, then switch back | Each switch lands on the home screen showing that profile's libraries |
| 1.6 | Close and relaunch the app | It signs in automatically and reaches the home screen without asking again |

## 2. Home screen

| # | Action | Expected result |
|---|---|---|
| 2.1 | Look at the library navigation at the top | Every library the server exposes is present. Nothing is missing |
| 2.2 | **Production only** — count the headings above the library tiles | There are none. Tiles read "Movies", "TV Shows", "Music" exactly as before |
| 2.3 | **Test unit only** — look for headings | Types with several libraries sit under a heading ("Movies", "TV Shows"); unrecognised ones sit under "Libraries"; a type with only one library has no heading |
| 2.4 | **Test unit only** — read the labels under a heading | Each shows the server's own name with the heading's word removed, e.g. "Trending" under "Movies", never a repeated "Movies / Movies" |
| 2.5 | Scroll down the home screen | Rows appear for "Continue Watching", "Next Up", "Latest Movies", "Latest Shows". A row with nothing in it is absent entirely, not an empty strip |
| 2.6 | **Test unit only** — keep scrolling past "Latest Shows" | At most four "Latest in <library>" rows appear, for libraries not already covered above |
| 2.7 | **Production only** — scroll past "Latest Shows" | No "Latest in ..." rows appear at all |
| 2.8 | Move focus across the cards in a row | The background artwork changes to follow the focused card |

## 3. Library browsing

| # | Action | Expected result |
|---|---|---|
| 3.1 | Open the Movies library | The grid fills with movie posters and the header shows "1 \| <total>" |
| 3.2 | Open the TV Shows library | The grid fills with series posters; series with unwatched episodes show a red count square in the top-left corner |
| 3.3 | Press the Menu button | The "Library options" panel opens |
| 3.4 | Change "Sort by" to "Date Added" | The grid reloads in date-added order |
| 3.5 | Change "Filter" to "Unwatched Only" | Only unwatched items remain |
| 3.6 | Change "Display: Image size" to "Large" | The posters get bigger and stay that way after leaving and re-entering |
| 3.7 | Press Back with the panel open | The panel closes and you stay in the library |
| 3.8 | Press Back again | You return to the home screen, with no exit prompt |
| 3.9 | Move focus across the grid | The right-hand panel updates with the focused item's artwork, synopsis and cast |
| 3.10 | **Test unit only** — open a library whose items resolve at playback time | The panel shows artwork, synopsis, genres and cast, and shows no quality, codec, container, bitrate or file-size row |
| 3.11 | **Test unit only** — open a library the server is still filling | The screen reads "Nothing here yet. The server may still be filling this library." with a Retry beside it, rather than staying blank |
| 3.12 | **Test unit only** — open a library that shows folders, then open a folder | The folder opens as its own library grid |
| 3.13 | Press Back from inside that folder | You return to the parent library, **not** to the home screen and **not** to an exit prompt |

## 4. Movies

| # | Action | Expected result |
|---|---|---|
| 4.1 | Open a movie from the library | The detail screen shows the title, year, runtime, rating, synopsis and cast |
| 4.2 | Press Play | Playback starts. A "Starting playback..." indicator is visible until it does |
| 4.3 | Let it play a minute, press Back, then confirm "Leave" | You return to the detail screen |
| 4.4 | Reopen the same movie | The button now reads "Resume", and a "Play from Start" button sits beside it |
| 4.5 | Press "Resume" | Playback resumes at roughly where you left it |
| 4.6 | Press "Play from Start" instead | Playback begins from the beginning |
| 4.7 | Press "Watched", then reopen the movie | The button reads "Unwatched" and the state survives leaving the screen |
| 4.8 | Press "Favorite", then check the library with "Favorites Only" | The movie is listed |
| 4.9 | Open a cast member from "Cast & Crew" | Their page opens and lists their other work |
| 4.10 | Open something from "More Like This" | That item's detail screen opens |

## 5. Series, seasons and episodes

| # | Action | Expected result |
|---|---|---|
| 5.1 | Open a series from the TV Shows library | Seasons appear, and the first season's episodes are listed below them |
| 5.2 | Pick a different season | That season's episodes replace the previous list |
| 5.3 | Tap an episode | The episode screen opens — it does **not** stay put and do nothing |
| 5.4 | Press Play on the episode | Playback starts |
| 5.5 | From the episode screen, press "Go to Series" | The series detail screen opens |
| 5.6 | From an episode mid-season, press "Previous" | The previous episode's screen opens |
| 5.7 | Press "Play All" on a series | The first episode starts playing |
| 5.8 | Press "Shuffle All" on a series | Some episode starts playing, preferring unwatched ones |
| 5.9 | **Test unit only** — open a series whose tree the server builds on demand | Seasons appear within a couple of seconds without touching anything. It does not sit empty |
| 5.10 | **Test unit only** — if it stays empty | The Episodes section reads "This show has no episodes to show yet." with a Retry, and Retry loads them |

## 6. Continue Watching and Next Up

| # | Action | Expected result |
|---|---|---|
| 6.1 | Watch a few minutes of an **episode**, leave, return to home | It appears in "Continue Watching" |
| 6.2 | Open that episode from "Continue Watching" | The **episode** screen opens — not a series screen showing one episode |
| 6.3 | Press Play there | It resumes near where you stopped |
| 6.4 | Watch a few minutes of a **movie**, leave, return to home | It appears in "Continue Watching" and opens on the movie's detail screen |
| 6.5 | Finish an episode, return to home | The next episode of that series appears under "Next Up" |
| 6.6 | Open it from "Next Up" | The episode screen opens and plays |

## 7. Playback

| # | Action | Expected result |
|---|---|---|
| 7.1 | Start any video | Picture and sound begin; the "Starting playback..." indicator disappears |
| 7.2 | Press Select to show the controls | Title, status text and a progress bar appear, then hide again on their own |
| 7.3 | Press fast-forward and rewind | The position moves and playback continues from the new point |
| 7.4 | Open the playback settings overlay and switch audio track | Audio changes to the chosen track and playback continues |
| 7.5 | Switch on a subtitle track | Subtitles appear |
| 7.6 | Press Back | "Stop Playback?" appears with "Stay" and "Leave" |
| 7.7 | Choose "Stay" | Playback continues |
| 7.8 | Press Back and choose "Leave" | You return to the screen you came from and the position is saved |
| 7.9 | **Test unit only** — play an item whose source resolves at playback time | It starts, possibly after a visible pause of a second or two |
| 7.10 | **Test unit only** — play an item the server cannot resolve | "Couldn't start this episode." (or movie) appears with Retry and Back. It does not hang on a black screen |
| 7.11 | Press Retry on that screen | It tries again and either starts or shows the same message |
| 7.12 | Press Back on that screen | You return to the previous screen |

## 8. Search

| # | Action | Expected result |
|---|---|---|
| 8.1 | Press "Search" on the home screen | The search screen opens and the on-screen keyboard is available |
| 8.2 | Search for a movie you own | It appears in the results |
| 8.3 | Open it and press Play | It plays |
| 8.4 | Search for a term matching an **episode** | Tapping the episode opens the episode screen, not a series screen |
| 8.5 | Search for something with no matches | The screen says so rather than sitting blank |
| 8.6 | Press Back | You return to the home screen |

## 9. Music

| # | Action | Expected result |
|---|---|---|
| 9.1 | Open Music from the home navigation | Artists, albums and playlists load |
| 9.2 | Open an artist | Their albums and top tracks appear |
| 9.3 | Open an album and play a track | Audio plays and the now-playing bar appears at the bottom |
| 9.4 | Browse to another screen while audio plays | The now-playing bar stays visible and audio keeps going |
| 9.5 | Open the now-playing screen from the bar | Track, artwork and transport controls appear |
| 9.6 | Open a playlist and play it | Tracks play in order |
| 9.7 | Turn music off in Settings, return home | Music and Playlists disappear from the navigation |

## 10. Stale and missing data

| # | Action | Expected result |
|---|---|---|
| 10.1 | Open a movie, then delete or rename its file on the server, then press Retry / reopen it | The screen reads "This item is no longer on the server." — it does not crash or go blank |
| 10.2 | Pull the network, then open any detail screen | An error message with a Retry appears |
| 10.3 | Restore the network and press Retry | The screen loads normally |
| 10.4 | Pull the network, then open a library | An error message with a Retry appears rather than an empty grid |

## 11. App lifecycle

| # | Action | Expected result |
|---|---|---|
| 11.1 | From the home screen, press Back three times quickly | The exit confirmation appears |
| 11.2 | Cancel it | You stay in the app on the home screen |
| 11.3 | Press Back once from any screen other than home | You go back one screen, with no exit prompt |
| 11.4 | Force-close and relaunch during playback | The app reopens and the item is still in "Continue Watching" at the right position |
| 11.5 | Sign out of a profile and back in | Libraries load and previous playback positions are still there |

---

## Recording results

For each run note: build number, profile (test unit or production), date, and
the step number of anything that failed with what you saw instead. A failed
step is a blocker unless it is explicitly marked as known and accepted.
