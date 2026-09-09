// Generated build input; never print operator values or copy them into Git.
//
// Every release carries the collector endpoint and token so telemetry can be
// armed on a device with the passphrase; it stays inert until then. A build
// that skips this step ships blanks, and the passphrase then appears to do
// nothing, so the operator file is found without anyone remembering to export
// anything: ASTRA_TELEMETRY_CONFIG (JSON), then ASTRA_TELEMETRY_ENV, then an
// untracked .telemetry.env beside package.json (a symlink to the real file is
// the usual arrangement — the secret must never live in the repo).
const fs = require('fs');
const path = require('path');
const source = process.env.ASTRA_TELEMETRY_CONFIG;
const localEnv = path.join(__dirname, '../.telemetry.env');
const envFile =
  process.env.ASTRA_TELEMETRY_ENV ??
  (fs.existsSync(localEnv) ? localEnv : undefined);
let config = {endpoint: '', token: ''};
if (envFile) {
  const content = fs.readFileSync(envFile, 'utf8');
  const read = (name) => {
    const match = content.match(new RegExp('^' + name + '=(.+)$', 'm'));
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : undefined;
  };
  const token = read('ASTRA_TELEMETRY_TOKEN');
  const endpoint = process.env.ASTRA_TELEMETRY_ENDPOINT ?? read('ASTRA_TELEMETRY_ENDPOINT');
  if (!token || !endpoint) throw new Error('Missing operator token or endpoint');
  config = {endpoint, token};
  const url = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid operator configuration');
}
if (source) {
  const input = JSON.parse(fs.readFileSync(source, 'utf8'));
  const url = new URL(input.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      typeof input.token !== 'string' || !input.token.trim()) {
    throw new Error('Invalid telemetry operator configuration');
  }
  config = {endpoint: input.endpoint, token: input.token};
}
const target = path.join(__dirname, '../src/services/telemetry/operator.generated.ts');
fs.mkdirSync(path.dirname(target), {recursive: true});
fs.writeFileSync(target, '// Generated; do not commit. Default configuration sends nothing.\nexport default ' + JSON.stringify(config) + ';\n', {mode: 0o600});
console.log(config.endpoint ? 'Telemetry operator configuration embedded (inert until armed on device).' : 'No telemetry operator configuration found; this build can never be armed.');
