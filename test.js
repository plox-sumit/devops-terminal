'use strict';
// Smoke test for the new-tab page.
//
//   node test.js
//
// Opens the real newtab.html in headless Chrome or Edge and answers every outside request
// (feeds, quote, AI) from the fixtures below, so it needs no network and no token.
// Needs Node 22+ and Chrome or Edge. Set BROWSER=/path/to/browser to pick one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const commandsFile = fs.readFileSync(path.join(ROOT, 'commands_with_desc.txt'), 'utf8');

const FEEDS = [...script.matchAll(/source: '([^']+)', url: '([^']+)'/g)].map(m => ({ source: m[1], url: m[2] }));
const QUOTE_URL = script.match(/QUOTES_API = '([^']+)'/)[1];
const AI_URL = 'https://ai.test/v1/chat/completions';
const DAILY_LIMIT = 2;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// ---------- fixtures ----------

// Stories 1-6 are from the last three hours; 7 and up are each a day older than the one before.
const NOW = Date.now();
const hoursOld = n => n <= 6 ? [0, 1, 2, 3, 0.5, 1.5][n - 1] : 24 * (n - 5);
const story = n => ({ title: 'Story number ' + n + ' headline', link: 'https://example.test/' + n, at: NOW - hoursOld(n) * 3600e3 });
const rss = items => '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>' + items.map(i =>
  '<item><title>' + i.title + '</title><link>' + i.link + '</link><pubDate>' + new Date(i.at).toUTCString() + '</pubDate></item>').join('') + '</channel></rss>';
const atom = items => '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">' + items.map(i =>
  '<entry><title>' + i.title + '</title><link rel="alternate" href="' + i.link + '"/><updated>' + new Date(i.at).toISOString() + '</updated></entry>').join('') + '</feed>';

// One of each case the page has to cope with. A string is a 200 body, a number a status, null a dead connection.
const feedReplies = {};
FEEDS.forEach((f, i) => { feedReplies[f.url] = rss([story(i + 1)]); });                   // feeds 6 and up: one old story each
feedReplies[FEEDS[0].url] = rss([story(1), story(2), story(3), story(4)]);                // only the first 3 of a feed are used
feedReplies[FEEDS[1].url] = atom([story(5), story(6)]);                                   // Atom instead of RSS
feedReplies[FEEDS[2].url] = rss([Object.assign(story(1), { link: 'https://example.test/dup', at: NOW - 600e3 })]);   // same title as story 1
feedReplies[FEEDS[3].url] = 500;
feedReplies[FEEDS[4].url] = '<rss><channel><item>';                                       // malformed
feedReplies[FEEDS[5].url] = null;
const SHOWN = [1, 5, 2, 6, 3, 7, 8, 9, 10, 11];                                           // newest first, no duplicate, 10 at most
const EXPECTED_NEWS = SHOWN.map(n => story(n).title);
const EXPECTED_DATES = SHOWN.map(n => dateKey(new Date(story(n).at)));
const GOOD_FEEDS = 3;                                                                     // feeds 0-2 answer with stories; 3-5 never do

// What the outside world does. hang: feed URLs that never answer. dead: feed URLs whose connection fails.
// configToken: the token in config.js.
const world = { down: false, hang: [], dead: [], configToken: 'test-token', aiPlan: [], aiCalls: [], hits: [] };

function reply(url, request) {
  if (url === QUOTE_URL) return world.down ? { status: 503 } : { type: 'application/json', body: JSON.stringify({ text: 'A fixture quote.', author: 'Tester' }) };
  if (url === AI_URL) {
    world.aiCalls.push(request);
    const status = world.aiPlan.shift() || 200;
    return { status, type: 'application/json', body: status === 200 ? JSON.stringify({ choices: [{ message: { content: 'What it does: test answer' } }] }) : '{}' };
  }
  if (url in feedReplies) {
    const r = world.down ? 503 : world.dead.includes(url) ? null : feedReplies[url];
    return r === null ? null : typeof r === 'number' ? { status: r } : { type: 'application/xml', body: r };
  }
  return { status: 404 };
}

// ---------- plumbing: static server, browser, DevTools connection ----------

function serve() {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.txt': 'text/plain', '.json': 'application/json', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(ROOT, name);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    // config.js is swapped for a test one: fake endpoint, small daily limit
    res.end(name !== 'config.js' ? fs.readFileSync(file) : 'var PLOX_CONFIG = ' + JSON.stringify({ HF_TOKEN: world.configToken, HF_MODEL: 'test-model', HF_ENDPOINT: AI_URL, DAILY_LIMIT }) + ';');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function findBrowser() {
  const found = [process.env.BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].find(p => p && fs.existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found. Set BROWSER=/path/to/browser');
  return found;
}

async function connect(profile) {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket('ws://127.0.0.1:' + port + wsPath);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map(), handlers = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (!m.id) { handlers.forEach(h => h(m)); return; }
    const p = pending.get(m.id); pending.delete(m.id);
    if (p) m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(nextId, { resolve, reject });
    ws.send(JSON.stringify({ id: nextId++, method, params, sessionId }));
  });
  return { send, on: h => handlers.push(h) };
}

// ---------- the test ----------

async function main() {
  // Every feed host needs a matching host permission, or its fetch is blocked in the extension.
  assert.equal(FEEDS.length > 0, true, 'no feeds found in script.js');
  assert.deepEqual([...new Set(FEEDS.map(f => new URL(f.url).origin))].sort(),
    manifest.host_permissions.map(p => p.replace(/\/\*$/, '')).sort(),
    'feed hosts in script.js and host_permissions in manifest.json must match');

  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'plox-test-'));
  // --disable-web-security stands in for the extension's host permissions (cross-origin fetches allowed).
  const browser = spawn(findBrowser(), ['--headless=new', '--disable-web-security', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let cdp;
  try {
    cdp = await connect(profile);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    let onLoad = null;
    cdp.on(m => {
      if (m.method === 'Page.loadEventFired' && onLoad) { onLoad(); onLoad = null; }
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      if (request.url.startsWith(base)) { send('Fetch.continueRequest', { requestId }).catch(() => { }); return; }
      world.hits.push(request.url);
      if (world.hang.includes(request.url)) return;   // never answered; dropped when the page navigates away
      const r = reply(request.url, request);
      (r === null
        ? send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' })
        : send('Fetch.fulfillRequest', { requestId, responseCode: r.status || 200, responseHeaders: [{ name: 'Content-Type', value: r.type || 'text/plain' }], body: Buffer.from(r.body || '').toString('base64') })
      ).catch(() => { });
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

    const run = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, what, ms = 8000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await run(expression)) return;
      throw new Error('timed out waiting for: ' + what);
    };
    const goto = async file => { const loaded = new Promise(r => { onLoad = r; }); await send('Page.navigate', { url: base + '/' + file }); await loaded; };
    // Opens the page with exactly the given localStorage.
    const open = async (storage = {}) => {
      await goto('manifest.json');
      await run('localStorage.clear(); Object.entries(' + JSON.stringify(storage) + ').forEach(([k, v]) => localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)))');
      await reopen();
    };
    // A new tab on the same storage.
    const reopen = async () => {
      world.hits = []; world.aiCalls = [];
      await goto('newtab.html');
      await waitFor('document.getElementById("cotdCommand").textContent !== ""', 'command of the day');
    };
    const feedHits = () => world.hits.filter(u => u in feedReplies).length;
    const allFeedsAsked = async n => { for (const end = Date.now() + 5000; feedHits() < n && Date.now() < end;) await sleep(50); };
    const newsTitles = () => run('[...document.querySelectorAll(".news-item .news-title")].map(e => e.textContent)');
    const key = (k, extra = {}) => run('document.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: ' + JSON.stringify(k) + ', bubbles: true, cancelable: true }, ' + JSON.stringify(extra) + ')))');
    const type = async text => { for (const ch of text) await key(ch); };
    const enter = async text => { await type(text); await key('Enter'); };
    const lastOutput = () => run('(([...document.querySelectorAll("#terminalContent .output")].pop() || {}).textContent || "")');
    const outputHas = text => '(([...document.querySelectorAll("#terminalContent .output")].pop() || {}).textContent || "").includes(' + JSON.stringify(text) + ')';
    const terminalHas = text => run('document.getElementById("terminalContent").textContent.includes(' + JSON.stringify(text) + ')');
    const stored = k => run('localStorage.getItem(' + JSON.stringify(k) + ')');
    const has = selector => run('!!document.querySelector(' + JSON.stringify(selector) + ')');

    // 1. First load of the day: every feed asked once, bad feeds skipped, list sorted and de-duplicated.
    await open();
    await waitFor('document.querySelectorAll(".news-item").length > 0', 'news items');
    assert.deepEqual(await newsTitles(), EXPECTED_NEWS);
    assert.deepEqual(await run('[...document.querySelectorAll(".news-item .news-date")].map(e => e.textContent)'), EXPECTED_DATES, 'each story shows the day it was published');
    assert.equal(await run('document.querySelector(".news-item .news-source").textContent'), FEEDS[0].source);
    assert.equal(await run('document.querySelector(".news-item").href'), 'https://example.test/1');
    assert.equal(feedHits(), FEEDS.length, 'each feed is asked exactly once');
    assert.equal(world.hits.filter(u => u === QUOTE_URL).length, 1);
    assert.equal(world.hits.length, FEEDS.length + 1, 'nothing else is fetched from outside');
    await waitFor('document.getElementById("dailyQuote").textContent.includes("A fixture quote.")', 'quote');
    const cotd = await run('({ cmd: document.getElementById("cotdCommand").textContent, desc: document.getElementById("cotdDesc").textContent })');
    assert.equal(commandsFile.split('\n').some(l => l.startsWith(cotd.cmd + ':')), true, 'command of the day comes from the commands file');
    assert.equal(cotd.desc.length > 0, true);
    assert.equal(await run('document.fonts.load("700 12px Manrope").then(f => f.length === 1 && f[0].status === "loaded")'), true, 'the bundled font loads');
    assert.equal(await stored('plox_news_progress'), null, 'refresh progress is cleared once the list is final');
    console.log('ok 1  first load: ' + FEEDS.length + ' feeds asked once, 10 stories in order with their dates, quote, command, font');

    // 2. Same day, another tab: everything comes from storage.
    await reopen();
    await sleep(300);
    assert.deepEqual(await newsTitles(), EXPECTED_NEWS);
    assert.equal(world.hits.length, 0, 'a second load makes no outside request at all');
    console.log('ok 2  second load: no outside requests');

    // 3. Everything down: a message instead of an endless "Fetching", then no retry until the wait is over.
    world.down = true;
    await open();
    await waitFor('document.getElementById("newsScroll").textContent.includes("Could not load")', 'failure message');
    assert.equal(feedHits(), FEEDS.length);
    assert.match(await run('document.getElementById("dailyQuote").textContent'), /Talk is cheap/);
    await reopen();
    await sleep(300);
    assert.equal(world.hits.length, 0, 'a failed refresh is not retried on the next tab');
    assert.match(await run('document.getElementById("newsScroll").textContent'), /Could not load/);
    console.log('ok 3  all sources down: message shown, next tab does not retry');

    // 4. Yesterday's news stays on screen when today's refresh fails.
    const stale = { source: 'Old Source', title: 'A stale story that must stay visible', link: 'https://example.test/old', date: '2000-01-01', timestamp: 1 };
    await open({ plox_news: { date: '2000-01-01', value: [stale] } });
    await allFeedsAsked(FEEDS.length);
    await sleep(300);
    assert.deepEqual(await newsTitles(), [stale.title]);
    world.down = false;
    console.log('ok 4  failed refresh keeps the saved list');

    // 5. A tab closed mid-refresh keeps what had arrived; the next tab asks only the rest.
    world.hang = FEEDS.slice(6).map(f => f.url);
    await open();
    await waitFor('Object.keys((JSON.parse(localStorage.getItem("plox_news_progress")) || { value: {} }).value).length === ' + GOOD_FEEDS, 'the feeds that answered to be saved');
    assert.equal(await has('.news-item'), false, 'no list yet while feeds are still out');
    world.hang = [];
    await reopen();
    await waitFor('document.querySelectorAll(".news-item").length > 0', 'news after resuming');
    assert.deepEqual(await newsTitles(), EXPECTED_NEWS);
    assert.equal(feedHits(), FEEDS.length - GOOD_FEEDS, 'feeds that already answered are not asked again');
    // ...and the same when the connection drops for most feeds: nothing is made final from the few that got through.
    world.dead = FEEDS.slice(GOOD_FEEDS).map(f => f.url);
    await open();
    await waitFor('document.getElementById("newsScroll").textContent.includes("Could not load")', 'failure message on a bad connection');
    assert.equal(await run('Object.keys(JSON.parse(localStorage.getItem("plox_news_progress")).value).length'), GOOD_FEEDS, 'what did arrive is kept');
    world.dead = [];
    await run('localStorage.removeItem("plox_news")');   // stands in for the 15-minute wait
    await reopen();
    await waitFor('document.querySelectorAll(".news-item").length > 0', 'news after the connection is back');
    assert.deepEqual(await newsTitles(), EXPECTED_NEWS);
    assert.equal(feedHits(), FEEDS.length - GOOD_FEEDS);
    console.log('ok 5  interrupted refresh and dropped connection: resumed with ' + (FEEDS.length - GOOD_FEEDS) + ' requests instead of ' + FEEDS.length);

    // 6. Terminal: built-ins, paste, saved answers, retry on 429, daily limit.
    world.aiPlan = [429];
    await open({ plox_commands_file_cache: '[]', 'plox_cmd_count_2026-01-01': '3', plox_news_v7: '[]', 'plox_ai_cached cmd': 'a saved answer' });
    assert.deepEqual(await run('["plox_commands_file_cache", "plox_cmd_count_2026-01-01", "plox_news_v7"].map(k => localStorage.getItem(k))'), [null, null, null], 'old keys are removed');
    await enter('whoami');
    assert.equal(await lastOutput(), 'user');
    await run('(() => { const d = new DataTransfer(); d.setData("text", "echo pasted text"); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true })); })()');
    await key('Enter');
    assert.equal(await lastOutput(), 'pasted text');
    await type('abc'); await key('c', { ctrlKey: true });
    assert.match(await run('[...document.querySelectorAll(".history-line")].pop().textContent'), /abc\^C$/);
    await enter('cached cmd');
    assert.equal(await lastOutput(), 'a saved answer');
    assert.equal(world.aiCalls.length, 0, 'a saved answer costs no request');
    await enter('docker ps');
    await waitFor(outputHas('test answer'), 'AI answer after a 429');
    assert.equal(world.aiCalls.length, 2, 'one 429, one retry');
    assert.equal(world.aiCalls[1].headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(world.aiCalls[1].postData).model, 'test-model');
    await enter('docker ps');
    assert.match(await lastOutput(), /test answer/);
    assert.equal(world.aiCalls.length, 2, 'the same command is answered from storage');
    await enter('kubectl get pods');
    await waitFor('!!document.querySelector(".terminal-disabled-msg")', 'daily limit message');
    assert.equal(world.aiCalls.length, 3);
    assert.equal(await has('#activeLine'), false, 'terminal locks at the limit');
    await reopen();
    assert.equal(await has('.terminal-disabled-msg'), true, 'limit message is shown again on the next tab');
    console.log('ok 6  terminal: built-ins, paste, Ctrl+C, saved answers, retry after 429, daily limit');

    // 7. A rejected token is reported once, with a hint, and the prompt comes back.
    world.aiPlan = [401];
    await open();
    await enter('ps aux');
    await waitFor(outputHas('API error: 401'), 'error output');
    assert.match(await lastOutput(), /token rejected/);
    assert.equal(world.aiCalls.length, 1, 'a 401 is not retried');
    assert.equal(await has('#activeLine'), true);
    assert.equal(await stored('plox_cmd_count'), null, 'a failed lookup does not use up the daily limit');
    console.log('ok 7  AI error: shown with a hint, not retried, not counted');

    // 8. The token command: saved in the browser, never echoed, kept out of the history, used at once.
    world.configToken = '';
    await open();
    assert.equal(await terminalHas('token hf_your_token_here'), true, 'a missing token is explained');
    await enter('docker ps');
    assert.match(await lastOutput(), /No API token configured/);
    assert.equal(world.aiCalls.length, 0);
    await enter('token hf_secret123');
    assert.match(await lastOutput(), /Token saved/);
    assert.equal(await terminalHas('hf_secret123'), false, 'the token is not echoed');
    assert.equal(await stored('plox_hf_token'), 'hf_secret123');
    await key('ArrowUp');
    assert.equal(await run('document.getElementById("input").textContent'), 'docker ps', 'the token is not in the up-arrow history');
    await key('Enter');
    await waitFor(outputHas('test answer'), 'AI answer with the saved token');
    assert.equal(world.aiCalls[0].headers.Authorization, 'Bearer hf_secret123');
    await reopen();
    assert.equal(await terminalHas('No Hugging Face token'), false, 'the saved token is used on the next tab');
    await enter('token clear');
    assert.equal(await stored('plox_hf_token'), null);
    world.configToken = 'test-token';
    console.log('ok 8  token command: saved, masked, not in history, used, cleared');

    // 9. Copy button, and a drawing that survives a window resize.
    await open();
    await run('document.getElementById("cotdCopyBtn").click()');
    assert.equal(await has('#cotdCopyBtn.copied'), true);
    await run('(() => { const c = document.getElementById("drawingCanvas"), r = c.getBoundingClientRect();'
      + ' const ev = (t, x, y) => c.dispatchEvent(new MouseEvent(t, { clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true }));'
      + ' ev("mousedown", 20, 20); ev("mousemove", 60, 60); ev("mouseup", 60, 60); })()');
    const canvasSize = 'document.getElementById("drawingCanvas").width + "x" + document.getElementById("drawingCanvas").height';
    const inked = 'document.getElementById("drawingCanvas").getContext("2d").getImageData(40, 40, 1, 1).data[3] > 0';
    assert.equal(await run(inked), true, 'a stroke is drawn');
    const sizeBefore = await run(canvasSize);
    await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 850, deviceScaleFactor: 1, mobile: false });
    await waitFor(canvasSize + ' !== ' + JSON.stringify(sizeBefore), 'the canvas to resize');
    assert.equal(await run(inked), true, 'the stroke survives a resize');
    await send('Emulation.clearDeviceMetricsOverride');
    console.log('ok 9  copy button, drawing kept on resize');

    // 10. Midnight: start the page 6 seconds before it, with the terminal locked, and let the day roll over.
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: '(' + function () {
      const Real = Date, target = new Real(); target.setHours(23, 59, 54, 0);
      const shift = target.getTime() - Real.now();
      window.Date = class extends Real {
        constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); }
        static now() { return Real.now() + shift; }
      };
    } + ')()' });
    await open({ plox_cmd_count: { date: dateKey(new Date()), value: DAILY_LIMIT } });
    const before = await run('document.getElementById("cotdCommand").textContent');
    assert.equal(await run('new Date().getHours()'), 23, 'the page must still be before midnight here');
    assert.equal(await has('.terminal-disabled-msg'), true);
    await allFeedsAsked(FEEDS.length);   // the refresh for the old day
    world.hits = [];
    await waitFor('!!document.getElementById("activeLine")', 'terminal to unlock after midnight', 10000);
    await waitFor('document.getElementById("cotdCommand").textContent !== ' + JSON.stringify(before), 'a new command of the day');
    await allFeedsAsked(FEEDS.length);
    assert.equal(feedHits(), FEEDS.length, 'news is fetched again for the new day');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    console.log('ok 10 midnight: new command, news refetched, terminal unlocked');

    console.log('\nall checks passed');
  } finally {
    if (cdp) await cdp.send('Browser.close').catch(() => { });
    for (let i = 0; i < 50 && browser.exitCode === null; i++) await sleep(100);
    browser.kill();
    server.close();
    // The browser's helper processes keep writing to the profile for a moment after it exits.
    for (let i = 0; i < 60 && fs.existsSync(profile); i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
      await sleep(250);
    }
  }
}

main().catch(err => { console.error('\nFAILED: ' + (err.stack || err)); process.exit(1); });
