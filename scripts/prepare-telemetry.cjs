// Generated build input; never print operator values or copy them into Git.
const fs = require('fs');
const path = require('path');
const source = process.env.ASTRA_TELEMETRY_CONFIG;
let config = {endpoint: '', token: ''};
if (process.env.ASTRA_TELEMETRY_ENV) {
  const content = fs.readFileSync(process.env.ASTRA_TELEMETRY_ENV, 'utf8');
  const match = content.match(/^ASTRA_TELEMETRY_TOKEN=(.+)$/m);
  if (!match || !process.env.ASTRA_TELEMETRY_ENDPOINT) throw new Error('Missing operator token or endpoint');
  config = {endpoint: process.env.ASTRA_TELEMETRY_ENDPOINT, token: match[1].trim().replace(/^['"]|['"]$/g, '')};
  const url = new URL(config.endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !config.token) throw new Error('Invalid operator configuration');
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
