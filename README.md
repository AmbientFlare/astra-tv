# Astra

Astra is a React Native media client for Amazon Vega OS Fire TV devices.

The goal is a fast, open source, multi-backend living-room client that starts
with Jellyfin support, then adds Kodi and Emby. The project is intentionally
early: the initial tree is the official Vega `helloWorld` React Native template
plus project metadata.

## Planned Backends

- Jellyfin
- Kodi
- Emby

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

## Reference Material

Reference repositories are kept outside this project under
`~/projects/reference`. They are for study only and are not incorporated into
this codebase.

## License

GPL-3.0. See [LICENSE](LICENSE).
