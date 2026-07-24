# Astra

Astra is a React Native media client for Amazon Vega OS Fire TV devices.

Astra is currently focused on Jellyfin support: connect to a user-provided
server, browse movie and TV libraries, view details, search, resume playback,
and play compatible media through the Vega media stack.

## Current Release

- App version: `1.0.3`
- Package ID: `com.astra.tv`
- Primary target: Fire TV devices running Amazon Vega OS
- Supported backend: Jellyfin

Future backend support for Emby and Kodi is planned, but not part of the
current submission build. Emby is shown as a disabled Coming soon option in
the setup wizard.

## Development

Install the Vega SDK, then from this directory:

```sh
npm install
npm run build:debug
```

To run on a Vega Virtual Device or hardware target, build a package and launch
it with the Vega CLI:

```sh
vega run-app <packageFile>
```

Release packaging notes are in [docs/release-build.md](docs/release-build.md).
Amazon Appstore submission notes are in
[docs/amazon-submission-v1.0.md](docs/amazon-submission-v1.0.md).

## Reference Material

Reference repositories are kept outside this project under
`~/projects/reference`. They are for study only and are not incorporated into
this codebase.

## License

Astra is source-available under the Astra Source-Available License
(Reference-Only) v1.0. See [LICENSE.md](LICENSE.md) and
[NOTICES.md](NOTICES.md).
