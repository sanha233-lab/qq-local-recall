'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'src');
const controlledFetch = path.join(root, 'core', 'qq-media-fetch.js');
const forbidden = [
  { name: 'network module', pattern: /require\(['"](?:node:)?(?:http|https|net|tls|dgram)['"]\)/ },
  { name: 'network API', pattern: /\b(?:fetch|WebSocket|EventSource)\s*\(/ },
  { name: 'network URL literal', pattern: /https?:\/\//i },
  { name: 'child process', pattern: /require\(['"](?:node:)?child_process['"]\)/ },
  { name: 'dynamic evaluation', pattern: /\b(?:eval|Function)\s*\(/ },
  { name: 'native module reference', pattern: /['"][^'"\r\n]+\.(?:node|dll)\b/i },
];

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? files(fullPath) : [fullPath];
  });
}

const failures = [];
for (const file of files(root)) {
  if (!/\.(?:js|mjs|html)$/.test(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    if (file === controlledFetch && (rule.name === 'network API' || rule.name === 'network URL literal')) continue;
    if (rule.pattern.test(content)) failures.push(`${path.relative(root, file)}: ${rule.name}`);
  }
}

const fetchSource = fs.readFileSync(controlledFetch, 'utf8');
const requiredFetchGuards = [
  ['HTTPS', /protocol\s*!==\s*['"]https:/],
  ['initial hosts', /multimedia\.nt\.qq\.com\.cn[\s\S]*gchat\.qpic\.cn/],
  ['download path', /pathname\s*!==\s*['"]\/download/],
  ['appid', /searchParams\.get\(['"]appid/],
  ['fileid', /searchParams\.get\(['"]fileid/],
  ['spec', /searchParams\.get\(['"]spec/],
  ['rkey', /searchParams\.get\(['"]rkey/],
  ['pending file match', /fileid\s*!==\s*String\(expectedFileUuid/],
  ['redirect limit', /MAX_REDIRECTS\s*=\s*2/],
  ['manual redirects', /redirect:\s*['"]manual/],
  ['10 second timeout', /DEFAULT_TIMEOUT_MS\s*=\s*10_000/],
  ['20 MiB limit', /MAX_MEDIA_BYTES/],
  ['magic bytes', /sniffImage\(bytes\)/],
];
for (const [name, pattern] of requiredFetchGuards) {
  if (!pattern.test(fetchSource)) failures.push(`core\\qq-media-fetch.js: missing ${name} guard`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Static audit passed: only the constrained QQ media module uses injected fetch; all required request guards are present.');
