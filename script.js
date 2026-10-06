(function () {
  'use strict';

  // ===========================
  // READ USER CONFIG
  // ===========================

  var cfg = window.PLOX_CONFIG || {};
  // A token saved with the terminal's "token" command wins over the one in config.js.
  var TOKEN_KEY = 'plox_hf_token';
  var HF_TOKEN = localStorage.getItem(TOKEN_KEY) || cfg.HF_TOKEN || '';
  var AI_ENDPOINT = cfg.HF_ENDPOINT || 'https://router.huggingface.co/v1/chat/completions';
  var AI_MODEL = cfg.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct:together';
  var MAX_DAILY_COMMANDS = cfg.DAILY_LIMIT || 5;

  var QUOTES_API = 'https://thequoteshub.com/api/';
  var COMMANDS_FILE = 'commands_with_desc.txt';

  var FETCH_TIMEOUT_MS = 8000;
  var RETRY_MS = 15 * 60 * 1000;
  var AI_TIMEOUT_MS = 20000;
  var AI_RETRIES = 2;
  var AI_CACHE_PREFIX = 'plox_ai_';

  // ===========================
  // UTILITIES
  // ===========================

  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getTodayKey() { return dateKey(new Date()); }

  function getMsUntilMidnight() {
    var now = new Date();
    var midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Whole local days since 1970, so it keeps counting across new year.
  function getDayNumber() {
    var now = new Date();
    return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
  }

  // ===========================
  // STORAGE
  // ===========================

  // localStorage throws when it is full. A failed write must never break a feature.
  function setItem(key, value) {
    try {
      try { localStorage.setItem(key, value); }
      catch (e) {
        // ponytail: when full, drop every saved AI answer (the only data that keeps growing)
        // and try once more. Evict oldest-first instead if losing them all ever hurts.
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf(AI_CACHE_PREFIX) === 0) localStorage.removeItem(k); });
        localStorage.setItem(key, value);
      }
    } catch (e2) { }
  }

  function store(key, value) { setItem(key, JSON.stringify(value)); }

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  // Values that are only good for the current day are saved as { date, value }.
  function storeToday(key, value) { store(key, { date: getTodayKey(), value: value }); }

  function loadToday(key) {
    var saved = load(key);
    return saved && saved.date === getTodayKey() ? saved.value : null;
  }

  // Keys written by older versions and no longer read (the saved commands file alone was ~180 KB).
  function dropLegacyKeys() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/^plox_(commands_file_cache|news(_date)?_v7|cotd(_date)?_v4|quote(_date)?_v5|cmd_count_.+)$/.test(k)) localStorage.removeItem(k);
      });
    } catch (e) { }
  }

  // Shows the saved copy straight away, then refreshes it at most once a day.
  // After a failed refresh it waits RETRY_MS, so a dead API is not hit on every new tab.
  // Resolves to false when there was nothing to show.
  async function showDaily(key, fetchValue, render) {
    var saved = load(key) || {};
    if (saved.value) render(saved.value);
    if (saved.date === getTodayKey() || Date.now() < saved.retryAt || !navigator.onLine) return !!saved.value;
    var value = await fetchValue();
    if (value) { storeToday(key, value); render(value); return true; }
    saved.retryAt = Date.now() + RETRY_MS;
    store(key, saved);
    return !!saved.value;
  }

  // ===========================
  // DAILY COUNTER
  // ===========================

  var COUNT_KEY = 'plox_cmd_count';

  function getDailyCommandCount() {
    return loadToday(COUNT_KEY) || 0;
  }

  function incrementDailyCommandCount() {
    var c = getDailyCommandCount() + 1;
    storeToday(COUNT_KEY, c);
    return c;
  }

  function hasReachedDailyLimit() {
    return getDailyCommandCount() >= MAX_DAILY_COMMANDS;
  }

  // ===========================
  // COMMANDS FILE (for COTD)
  // ===========================

  async function loadCommandsFile() {
    try {
      var response = await fetch(COMMANDS_FILE);
      if (!response.ok) throw new Error('not found');
      var text = await response.text();
      var lines = text.split('\n');
      var cmds = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var ci = line.indexOf(':');
        if (ci === -1) continue;
        var name = line.substring(0, ci).trim();
        var rest = line.substring(ci + 1).trim();
        // "name - description"; some lines use "--", an em dash or a Unicode hyphen instead
        var sep = rest.match(/\s(?:--?|\u2014|\u2010)\s+/);
        var desc = sep ? rest.substring(sep.index + sep[0].length).trim() : rest;
        if (name && desc) cmds.push({ cmd: name, desc: desc });
      }
      return cmds;
    } catch (e) {
      return [];
    }
  }

  var fallbackCommands = [
    { cmd: 'find / -name "*.log" -mtime +7 -delete', desc: 'Delete all .log files older than 7 days.' },
    { cmd: 'docker system prune -af --volumes', desc: 'Remove all unused Docker data.' },
    { cmd: 'kubectl get pods -A -o wide', desc: 'List all pods across namespaces.' },
    { cmd: 'ss -tulnp', desc: 'Show listening ports with process info.' },
    { cmd: 'git log --oneline --graph --all', desc: 'Visual Git history graph.' }
  ];

  // ===========================
  // NEWS
  // ===========================

  var NEWS_KEY = 'plox_news';
  var NEWS_HISTORY_KEY = 'plox_news_title_history';
  var NEWS_PROGRESS_KEY = 'plox_news_progress';

  // Feeds are fetched directly, so every host below must also be listed under
  // "host_permissions" in manifest.json (test.js checks the two lists agree).
  var rssFeedUrls = [
    { source: 'DevOps.com', url: 'https://devops.com/feed/' },
    { source: 'The New Stack', url: 'https://thenewstack.io/feed/' },
    { source: 'InfoQ DevOps', url: 'https://feed.infoq.com/devops/' },
    { source: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml' },
    { source: 'CNCF Blog', url: 'https://www.cncf.io/feed/' },
    { source: 'Container Solutions', url: 'https://blog.container-solutions.com/rss.xml' },
    { source: 'Docker Blog', url: 'https://www.docker.com/feed/' },
    { source: 'Sysdig Blog', url: 'https://www.sysdig.com/blog/rss.xml' },
    { source: 'AWS DevOps Blog', url: 'https://aws.amazon.com/blogs/devops/feed/' },
    { source: 'Google Cloud Blog', url: 'https://cloudblog.withgoogle.com/rss/' },
    { source: 'Azure Blog', url: 'https://azure.microsoft.com/en-us/blog/feed/' },
    { source: 'Meta Engineering', url: 'https://engineering.fb.com/feed/' },
    { source: 'Netflix Tech Blog', url: 'https://netflixtechblog.com/feed' },
    { source: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/' }
  ];

  function extractLink(node) {
    var links = node.querySelectorAll('link');
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute('href');
      if (h && h.trim().startsWith('http')) {
        var r = links[i].getAttribute('rel');
        if (!r || r === 'alternate') return h.trim();
      }
      var t = links[i].textContent ? links[i].textContent.trim() : '';
      if (t.startsWith('http')) return t;
    }
    for (var j = 0; j < links.length; j++) {
      var h2 = links[j].getAttribute('href');
      if (h2 && h2.trim().startsWith('http')) return h2.trim();
    }
    var guid = node.querySelector('guid');
    if (guid) { var g = guid.textContent ? guid.textContent.trim() : ''; if (g.startsWith('http')) return g; }
    var id = node.querySelector('id');
    if (id) { var d = id.textContent ? id.textContent.trim() : ''; if (d.startsWith('http')) return d; }
    return '';
  }

  function extractTitle(node) {
    var t = node.querySelector('title');
    if (t && t.textContent) return t.textContent.trim().replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
    return '';
  }

  function extractPubDate(node) {
    var p = node.querySelector('pubDate');
    if (p && p.textContent) return new Date(p.textContent.trim());
    p = node.querySelector('published');
    if (p && p.textContent) return new Date(p.textContent.trim());
    p = node.querySelector('updated');
    if (p && p.textContent) return new Date(p.textContent.trim());
    return new Date();
  }

  function titleKey(item) { return item.title.toLowerCase().substring(0, 60); }

  // Resolves to the feed's stories, [] when it answered with nothing usable (error page,
  // malformed XML), or null when it gave no answer at all (timeout, no connection).
  async function fetchSingleFeed(feed) {
    try {
      var r = await fetch(feed.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!r.ok) return [];
      var xml = new DOMParser().parseFromString(await r.text(), 'text/xml');
      if (xml.querySelector('parsererror')) return [];
      var nodes = xml.querySelectorAll('item, entry');
      var results = [];
      for (var i = 0; i < Math.min(nodes.length, 3); i++) {
        var title = extractTitle(nodes[i]);
        if (!title || title.length < 10) continue;
        var link = extractLink(nodes[i]);
        if (!link) continue;
        var published = extractPubDate(nodes[i]);
        if (isNaN(published)) published = new Date();
        results.push({ source: feed.source, title: title, link: link, date: dateKey(published), timestamp: published.getTime() });
      }
      return results;
    } catch (e) { return null; }
  }

  // Each feed's stories are saved as they arrive, so a tab closed mid-refresh loses nothing:
  // the next tab asks only the feeds that have not answered yet today.
  async function fetchNews() {
    var answered = loadToday(NEWS_PROGRESS_KEY) || {};
    var silent = 0;
    await Promise.all(rssFeedUrls.map(async function (feed) {
      if (answered[feed.url]) return;
      var items = await fetchSingleFeed(feed);
      if (!items) { silent++; return; }
      if (items.length > 0) { answered[feed.url] = items; storeToday(NEWS_PROGRESS_KEY, answered); }
    }));
    // Most feeds silent means the connection is the problem, not the feeds: keep what
    // arrived and let the next try (after RETRY_MS) ask for the rest.
    if (silent * 2 > rssFeedUrls.length) return null;
    localStorage.removeItem(NEWS_PROGRESS_KEY);

    var seen = {}, unique = [];
    rssFeedUrls.forEach(function (feed) {
      (answered[feed.url] || []).forEach(function (item) {
        var k = titleKey(item);
        if (!seen[k]) { seen[k] = true; unique.push(item); }
      });
    });
    if (unique.length === 0) return null;
    unique.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    var latest = unique.slice(0, 10);

    // Leave out stories shown on an earlier day, unless that leaves nothing.
    var history = load(NEWS_HISTORY_KEY) || [];
    var fresh = latest.filter(function (item) { return history.indexOf(titleKey(item)) === -1; });
    store(NEWS_HISTORY_KEY, history.concat(fresh.map(titleKey)).slice(-200));
    return fresh.length > 0 ? fresh : latest;
  }

  function renderNews(items) {
    var c = document.getElementById('newsScroll');
    c.innerHTML = '';
    items.forEach(function (item) {
      var el = document.createElement('a');
      el.className = 'news-item'; el.href = item.link; el.target = '_blank'; el.rel = 'noopener noreferrer';
      el.innerHTML = '<span class="news-source">' + escapeHtml(item.source) + '</span><span class="news-title">' + escapeHtml(item.title) + '</span><span class="news-date">' + escapeHtml(item.date) + '</span>';
      c.appendChild(el);
    });
  }

  async function showNews() {
    if (await showDaily(NEWS_KEY, fetchNews, renderNews)) return;
    document.getElementById('newsScroll').innerHTML = '<div class="news-loading">Could not load the news. Will try again in a few minutes.</div>';
  }

  // ===========================
  // DRAWING BOARD
  // ===========================

  // Returns a function that wipes the board.
  function initDrawingBoard() {
    var canvas = document.getElementById('drawingCanvas');
    var ctx = canvas.getContext('2d');
    var colorPicker = document.getElementById('drawColor');
    var brushSelect = document.getElementById('brushSize');
    var clearBtn = document.getElementById('clearCanvas');

    function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

    // Changing a canvas's size wipes it, so the drawing is copied out and put back.
    function resize() {
      var p = canvas.parentElement;
      var tb = p.querySelector('.card-titlebar');
      var kept = canvas.width && canvas.height ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
      canvas.width = p.clientWidth;
      canvas.height = p.clientHeight - (tb ? tb.offsetHeight : 38);
      if (kept) ctx.putImageData(kept, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    var drawing = false, lastX = 0, lastY = 0;
    function getPos(e) {
      var r = canvas.getBoundingClientRect();
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
    }
    function start(e) { e.preventDefault(); drawing = true; var p = getPos(e); lastX = p.x; lastY = p.y; }
    function draw(e) {
      if (!drawing) return; e.preventDefault(); var p = getPos(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = colorPicker.value; ctx.lineWidth = parseInt(brushSelect.value, 10);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      lastX = p.x; lastY = p.y;
    }
    function stop() { drawing = false; }

    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stop); canvas.addEventListener('mouseleave', stop);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stop);
    clearBtn.addEventListener('click', clear);
    return clear;
  }

  // ===========================
  // COMMAND OF THE DAY
  // ===========================

  var COTD_KEY = 'plox_cotd';
  var cotd = null;

  async function showCOTD() {
    cotd = loadToday(COTD_KEY);
    if (!cotd) {
      var cmds = await loadCommandsFile();
      if (cmds.length === 0) cmds = fallbackCommands;
      // Stepping by a prime visits every command before any repeats, in a scattered order.
      cotd = cmds[(getDayNumber() * 7919) % cmds.length];
      storeToday(COTD_KEY, cotd);
    }
    document.getElementById('cotdCommand').textContent = cotd.cmd;
    document.getElementById('cotdDesc').textContent = cotd.desc;
  }

  function initCOTDCopy() {
    var btn = document.getElementById('cotdCopyBtn');
    btn.addEventListener('click', function () {
      if (!cotd) return;
      navigator.clipboard.writeText(cotd.cmd).catch(function () { });
      btn.classList.add('copied');
      setTimeout(function () { btn.classList.remove('copied'); }, 2000);
    });
  }

  // ===========================
  // PROFILE
  // ===========================

  function initProfile() {
    var circle = document.getElementById('profileCircle');
    var input = document.getElementById('pfpInput');
    var img = document.getElementById('pfpImg');
    var text = document.getElementById('pfpText');
    var saved = localStorage.getItem('plox_pfp');
    if (saved) { img.src = saved; img.style.display = 'block'; text.style.display = 'none'; }
    circle.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        var tmp = new Image();
        tmp.onload = function () {
          var c = document.createElement('canvas'); c.width = 120; c.height = 120;
          c.getContext('2d').drawImage(tmp, 0, 0, 120, 120);
          var comp = c.toDataURL('image/jpeg', 0.7);
          img.src = comp; img.style.display = 'block'; text.style.display = 'none';
          setItem('plox_pfp', comp);
        };
        tmp.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ===========================
  // DAILY QUOTE
  // ===========================

  var QUOTE_KEY = 'plox_quote';

  async function fetchQuote() {
    try {
      var r = await fetch(QUOTES_API, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      var data = r.ok ? await r.json() : null;
      if (!data || !data.text) return null;
      return { text: data.text.trim(), author: (data.author || 'Unknown').trim() };
    } catch (e) { return null; }
  }

  function renderQuote(quote) {
    document.getElementById('dailyQuote').innerHTML = '\u201C' + escapeHtml(quote.text) + '\u201D<span class="quote-author"> by ' + escapeHtml(quote.author) + '</span>';
  }

  async function showQuote() {
    if (await showDaily(QUOTE_KEY, fetchQuote, renderQuote)) return;
    renderQuote({ text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' });
  }

  // ===========================
  // TERMINAL
  // ===========================

  var builtinCommands = {
    help: function () {
      return 'Available commands:\n  help, clear, date, whoami, hostname,\n  uname -a, uptime, pwd, echo, ls\n\nAny other command → AI explanation (' + MAX_DAILY_COMMANDS + '/day).\nCtrl+V to paste.\n\ntoken hf_...   save your Hugging Face token in this browser\ntoken clear    forget it';
    },
    date: function () { return new Date().toString(); },
    whoami: function () { return 'user'; },
    hostname: function () { return 'devops-dashboard'; },
    'uname -a': function () { return 'Linux devops-dashboard 6.1.0-generic #1 SMP x86_64 GNU/Linux'; },
    uname: function () { return 'Linux'; },
    uptime: function () { var n = new Date(); return ' ' + String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0') + ' up 42 days, 3:17, 1 user, load average: 0.12, 0.08, 0.05'; },
    pwd: function () { return '/home/user'; },
    ls: function () { return 'Desktop  Documents  Downloads  .bashrc  .config  projects  scripts'; },
    'ls -la': function () { return 'total 48\ndrwxr-xr-x  8 user user 4096 Jan 15 10:30 .\ndrwxr-xr-x  3 root root 4096 Jan  1 00:00 ..\n-rw-r--r--  1 user user  220 Jan  1 00:00 .bashrc\ndrwxr-xr-x  2 user user 4096 Jan 15 10:30 Desktop\ndrwxr-xr-x  2 user user 4096 Jan 10 08:15 Documents\ndrwxr-xr-x  2 user user 4096 Jan 12 14:22 Downloads\ndrwxr-xr-x  5 user user 4096 Jan 14 09:00 projects\ndrwxr-xr-x  3 user user 4096 Jan 13 11:45 scripts'; },
    'ls -l': function () { return 'total 40\ndrwxr-xr-x  2 user user 4096 Jan 15 10:30 Desktop\ndrwxr-xr-x  2 user user 4096 Jan 10 08:15 Documents\ndrwxr-xr-x  2 user user 4096 Jan 12 14:22 Downloads\ndrwxr-xr-x  5 user user 4096 Jan 14 09:00 projects\ndrwxr-xr-x  3 user user 4096 Jan 13 11:45 scripts'; }
  };

  var commandHistory = [], historyIndex = -1, currentInput = '', terminalLocked = false, processingCommand = false;

  function initTerminal() {
    // Check if token is configured
    if (!HF_TOKEN) {
      var tc = document.getElementById('terminalContent');
      var warnDiv = document.createElement('div');
      warnDiv.className = 'output';
      warnDiv.textContent = '\u26A0\uFE0F  No Hugging Face token yet. Type:  token hf_your_token_here\n    Built-in commands (help, ls, date, etc.) still work.\n';
      var activeLine = document.getElementById('activeLine');
      if (activeLine) tc.insertBefore(warnDiv, activeLine);
    }

    if (hasReachedDailyLimit()) showLimit();

    document.addEventListener('keydown', function (e) {
      var act = document.activeElement;
      if (act && (act.tagName === 'INPUT' || act.tagName === 'SELECT' || act.tagName === 'TEXTAREA')) return;
      if (terminalLocked || processingCommand) return;
      var inp = document.getElementById('input');
      if (!inp) return;

      if (e.ctrlKey && e.key === 'c') {
        if (String(window.getSelection())) return;   // text is selected: let the browser copy it
        e.preventDefault(); freezeLine(currentInput + '^C'); currentInput = ''; newPrompt(); return;
      }
      if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerm(); return; }
      if (e.ctrlKey || e.metaKey) return;   // includes Ctrl+V, which arrives as the paste event below

      if (e.key === 'Enter') {
        e.preventDefault(); var cmd = currentInput.trim();
        if (!cmd) { freezeLine(''); newPrompt(); return; }
        if (!cmd.startsWith('token ')) commandHistory.push(cmd);   // keep the token out of the up-arrow history
        historyIndex = commandHistory.length;
        currentInput = ''; inp.textContent = ''; processCommand(cmd);
      } else if (e.key === 'Backspace') { e.preventDefault(); if (currentInput.length > 0) { currentInput = currentInput.slice(0, -1); inp.textContent = currentInput; } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (commandHistory.length > 0 && historyIndex > 0) { historyIndex--; currentInput = commandHistory[historyIndex]; inp.textContent = currentInput; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (historyIndex < commandHistory.length - 1) { historyIndex++; currentInput = commandHistory[historyIndex]; inp.textContent = currentInput; } else { historyIndex = commandHistory.length; currentInput = ''; inp.textContent = ''; } }
      else if (e.key === 'Tab') { e.preventDefault(); }
      else if (e.key.length === 1 && !e.altKey) { e.preventDefault(); currentInput += e.key; inp.textContent = currentInput; scrollToBottom(); }
    });

    document.addEventListener('paste', function (e) {
      var act = document.activeElement;
      if (act && (act.tagName === 'INPUT' || act.tagName === 'SELECT' || act.tagName === 'TEXTAREA')) return;
      if (terminalLocked || processingCommand) return;
      var inp = document.getElementById('input'); if (!inp) return;
      var t = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (t) { currentInput += t.replace(/[\r\n]+/g, ' ').trim(); inp.textContent = currentInput; scrollToBottom(); e.preventDefault(); }
    });

    document.getElementById('terminal').addEventListener('click', function () {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    });
  }

  function scrollToBottom() {
    var t = document.getElementById('terminal');
    requestAnimationFrame(function () { t.scrollTop = t.scrollHeight; });
  }

  function freezeLine(text) {
    var al = document.getElementById('activeLine'); if (!al) return;
    var f = document.createElement('div'); f.className = 'line history-line';
    f.innerHTML = '<span class="prompt">user$&nbsp;</span><span>' + escapeHtml(text) + '</span>';
    al.parentNode.insertBefore(f, al);
  }

  function newPrompt() {
    var al = document.getElementById('activeLine'); if (al) al.remove();
    var tc = document.getElementById('terminalContent');
    var nl = document.createElement('div'); nl.className = 'line active'; nl.id = 'activeLine';
    nl.innerHTML = '<span class="prompt">user$&nbsp;</span><span id="input"></span><span class="cursor"></span>';
    tc.appendChild(nl); currentInput = ''; processingCommand = false; scrollToBottom();
  }

  function addOutput(text) {
    var tc = document.getElementById('terminalContent');
    var o = document.createElement('div'); o.className = 'output'; o.textContent = text;
    tc.appendChild(o); scrollToBottom();
  }

  function showLimit() {
    var tc = document.getElementById('terminalContent');
    var al = document.getElementById('activeLine'); if (al) al.remove();
    var m = document.createElement('div'); m.className = 'output terminal-disabled-msg';
    m.textContent = '\n\u2728 enough learning for today, drink water :-)\n\nDaily limit reached (' + MAX_DAILY_COMMANDS + '/' + MAX_DAILY_COMMANDS + ').\nCome back tomorrow!';
    tc.appendChild(m); terminalLocked = true; processingCommand = false; scrollToBottom();
  }

  function clearTerm() {
    document.getElementById('terminalContent').innerHTML = '';
    if (!terminalLocked) newPrompt(); else showLimit();
  }

  function makeLoader() {
    var tc = document.getElementById('terminalContent');
    var ld = document.createElement('div'); ld.className = 'output'; ld.id = 'loadingIndicator';
    var dots = 0; ld.textContent = '\u23F3 thinking';
    ld._interval = setInterval(function () { dots = (dots + 1) % 4; ld.textContent = '\u23F3 thinking' + '.'.repeat(dots); }, 300);
    tc.appendChild(ld); scrollToBottom(); return ld;
  }

  // Asks the model once, retrying only what a retry can fix: rate limits (429) and server errors (5xx).
  async function askAI(cmd) {
    for (var attempt = 0; ; attempt++) {
      var r = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HF_TOKEN },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Explain this Linux command clearly:\n\nCommand: ' + cmd + '\n\nFormat:\n\ud83d\udcd8 What it does:\n\ud83d\udd0d Breakdown:\n\ud83d\udca1 When to use:\nKeep under 80 words. Be concise.' }],
          model: AI_MODEL, max_tokens: 150, temperature: 0.3
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS)
      });
      if (r.ok) {
        var data = await r.json();
        var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error('the model sent back an empty answer');
        return content;
      }
      if ((r.status !== 429 && r.status < 500) || attempt >= AI_RETRIES) {
        var hint = r.status === 401 || r.status === 403 ? ' (token rejected, set a new one with: token hf_your_token_here)' : r.status === 429 ? ' (rate limited, try again in a minute)' : '';
        throw new Error('API error: ' + r.status + hint);
      }
      var waitMs = Math.min(Number(r.headers.get('Retry-After')) * 1000 || 1000 * Math.pow(2, attempt), 8000);
      await new Promise(function (resolve) { setTimeout(resolve, waitMs); });
    }
  }

  // Keeps the Hugging Face token in this browser, so it never has to sit in a file that git tracks.
  function tokenCommand(arg) {
    if (!arg) return (HF_TOKEN ? 'A token is set.' : 'No token set.') + '\nUsage:  token hf_your_token_here   or   token clear';
    if (arg === 'clear') { localStorage.removeItem(TOKEN_KEY); HF_TOKEN = cfg.HF_TOKEN || ''; return 'Saved token removed.'; }
    setItem(TOKEN_KEY, arg); HF_TOKEN = arg;
    return 'Token saved in this browser.';
  }

  async function processCommand(cmd) {
    freezeLine(cmd.startsWith('token ') && cmd !== 'token clear' ? 'token ********' : cmd);
    var al = document.getElementById('activeLine'); if (al) al.remove();
    processingCommand = true;

    if (cmd === 'clear') { processingCommand = false; clearTerm(); return; }
    if (cmd.startsWith('echo ')) { addOutput(cmd.substring(5)); newPrompt(); return; }
    if (cmd === 'token' || cmd.startsWith('token ')) { addOutput(tokenCommand(cmd.substring(5).trim())); newPrompt(); return; }
    if (builtinCommands[cmd]) { addOutput(builtinCommands[cmd]()); newPrompt(); return; }

    // Check cache
    var cached = localStorage.getItem(AI_CACHE_PREFIX + cmd);
    if (cached) { addOutput(cached); newPrompt(); return; }

    if (hasReachedDailyLimit()) { showLimit(); return; }

    if (!HF_TOKEN) {
      addOutput('\u26A0\uFE0F  No API token configured.\nType:  token hf_your_token_here  to get AI explanations.');
      newPrompt(); return;
    }

    var loader = makeLoader(), content, error;
    try { content = await askAI(cmd); } catch (err) { error = err; }
    clearInterval(loader._interval); loader.remove();

    if (error) {
      addOutput('\u274C Error: ' + (error.name === 'TimeoutError' ? 'no answer after ' + AI_TIMEOUT_MS / 1000 + ' seconds' : error.message));
      newPrompt(); return;
    }
    setItem(AI_CACHE_PREFIX + cmd, content);
    var count = incrementDailyCommandCount();
    addOutput(content);
    if (count >= MAX_DAILY_COMMANDS) { showLimit(); return; }
    newPrompt();
  }

  // ===========================
  // INIT
  // ===========================

  function showDailyContent() {
    showNews();
    showCOTD();
    showQuote();
  }

  function init() {
    dropLegacyKeys();
    var clearDrawing = initDrawingBoard();
    initProfile();
    initTerminal();
    initCOTDCopy();
    showDailyContent();

    // One timer rolls everything over when the date changes.
    (function scheduleMidnight() {
      setTimeout(function () {
        clearDrawing();
        showDailyContent();
        if (terminalLocked) { terminalLocked = false; newPrompt(); }
        scheduleMidnight();
      }, getMsUntilMidnight() + 1000);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
