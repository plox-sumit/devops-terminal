(function () {
  'use strict';

  // ===========================
  // READ USER CONFIG
  // ===========================

  var HF_TOKEN = (typeof PLOX_CONFIG !== 'undefined' && PLOX_CONFIG.HF_TOKEN) ? PLOX_CONFIG.HF_TOKEN : '';
  var AI_ENDPOINT = (typeof PLOX_CONFIG !== 'undefined' && PLOX_CONFIG.HF_ENDPOINT) ? PLOX_CONFIG.HF_ENDPOINT : 'https://router.huggingface.co/v1/chat/completions';
  var AI_MODEL = (typeof PLOX_CONFIG !== 'undefined' && PLOX_CONFIG.HF_MODEL) ? PLOX_CONFIG.HF_MODEL : 'Qwen/Qwen2.5-7B-Instruct:together';
  var MAX_DAILY_COMMANDS = (typeof PLOX_CONFIG !== 'undefined' && PLOX_CONFIG.DAILY_LIMIT) ? PLOX_CONFIG.DAILY_LIMIT : 5;

  var QUOTES_API = 'https://thequoteshub.com/api/';
  var COMMANDS_FILE = 'commands_with_desc.txt';

  // ===========================
  // UTILITIES
  // ===========================

  function getTodayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

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

  function getDayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  // ===========================
  // CLIPBOARD
  // ===========================

  var clipboardContent = '';
  function setClipboard(text) {
    clipboardContent = text;
    navigator.clipboard.writeText(text).catch(function () { });
  }
  function getClipboard() { return clipboardContent; }

  // ===========================
  // DAILY COUNTER
  // ===========================

  function getDailyCommandCount() {
    var val = localStorage.getItem('plox_cmd_count_' + getTodayKey());
    return val ? parseInt(val, 10) : 0;
  }

  function incrementDailyCommandCount() {
    var key = 'plox_cmd_count_' + getTodayKey();
    var c = getDailyCommandCount() + 1;
    localStorage.setItem(key, String(c));
    return c;
  }

  function hasReachedDailyLimit() {
    return getDailyCommandCount() >= MAX_DAILY_COMMANDS;
  }

  // ===========================
  // COMMANDS FILE (for COTD)
  // ===========================

  var COMMANDS_CACHE_KEY = 'plox_commands_file_cache';

  async function loadCommandsFile() {
    var cached = localStorage.getItem(COMMANDS_CACHE_KEY);
    if (cached) {
      try {
        var p = JSON.parse(cached);
        if (p && p.length > 0) return p;
      } catch (e) { }
    }
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
        var di = rest.indexOf(' - ');
        var desc = di !== -1 ? rest.substring(di + 3).trim() : rest;
        if (name && desc) cmds.push({ cmd: name, desc: desc });
      }
      if (cmds.length > 0) localStorage.setItem(COMMANDS_CACHE_KEY, JSON.stringify(cmds));
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

  var NEWS_STORAGE_KEY = 'plox_news_v7';
  var NEWS_DATE_KEY = 'plox_news_date_v7';

  var rssFeedUrls = [
    { source: 'DevOps.com', url: 'https://devops.com/feed/' },
    { source: 'The New Stack', url: 'https://thenewstack.io/feed/' },
    { source: 'DZone DevOps', url: 'https://dzone.com/devops-tutorials-tools-news.rss' },
    { source: 'InfoQ DevOps', url: 'https://www.infoq.com/devops/rss/' },
    { source: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml' },
    { source: 'CNCF Blog', url: 'https://www.cncf.io/feed/' },
    { source: 'Container Solutions', url: 'https://blog.container-solutions.com/rss.xml' },
    { source: 'Weaveworks', url: 'https://www.weave.works/blog/rss' },
    { source: 'Docker Blog', url: 'https://www.docker.com/blog/feed/' },
    { source: 'Sysdig Blog', url: 'https://sysdig.com/blog/feed/' },
    { source: 'AWS DevOps Blog', url: 'https://aws.amazon.com/blogs/devops/feed/' },
    { source: 'Google Cloud Blog', url: 'https://cloud.google.com/blog/rss/' },
    { source: 'Azure Blog', url: 'https://azure.microsoft.com/en-us/blog/feed/' },
    { source: 'Meta Engineering', url: 'https://engineering.fb.com/feed/' },
    { source: 'Netflix Tech Blog', url: 'https://netflixtechblog.com/feed' },
    { source: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/' }
  ];

  var CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
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

  async function fetchSingleFeed(feed, proxy) {
    try {
      var r = await fetch(proxy + encodeURIComponent(feed.url), { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return [];
      var text = await r.text();
      if (!text || text.length < 100) return [];
      var xml = new DOMParser().parseFromString(text, 'text/xml');
      if (xml.querySelector('parsererror')) return [];
      var items = xml.querySelectorAll('item');
      var entries = xml.querySelectorAll('entry');
      var nodes = items.length > 0 ? items : entries;
      var results = [];
      for (var i = 0; i < Math.min(nodes.length, 3); i++) {
        var title = extractTitle(nodes[i]);
        if (!title || title.length < 10) continue;
        var link = extractLink(nodes[i]);
        if (!link) continue;
        results.push({ source: feed.source, title: title, link: link, date: getTodayKey(), timestamp: extractPubDate(nodes[i]).getTime() });
      }
      return results;
    } catch (e) { return []; }
  }

  async function fetchAllNews() {
    var all = [];
    for (var p = 0; p < CORS_PROXIES.length; p++) {
      var results = await Promise.all(rssFeedUrls.map(function (f) { return fetchSingleFeed(f, CORS_PROXIES[p]); }));
      results.forEach(function (r) { all = all.concat(r); });
      if (all.length >= 10) break;
    }
    var seen = {}, unique = [];
    for (var i = 0; i < all.length; i++) {
      var k = all[i].title.toLowerCase().substring(0, 60);
      if (!seen[k]) { seen[k] = true; unique.push(all[i]); }
    }
    unique.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
    return unique.slice(0, 10);
  }

  function filterPreviouslyShown(items) {
    var hk = 'plox_news_title_history';
    var history = [];
    try { var h = localStorage.getItem(hk); if (h) history = JSON.parse(h); } catch (e) { }
    var hs = {}; history.forEach(function (t) { hs[t] = true; });
    var filtered = [], newH = history.slice();
    for (var i = 0; i < items.length; i++) {
      var tk = items[i].title.toLowerCase().substring(0, 60);
      if (!hs[tk]) { filtered.push(items[i]); newH.push(tk); }
    }
    if (filtered.length === 0) filtered = items;
    if (newH.length > 200) newH = newH.slice(newH.length - 200);
    localStorage.setItem(hk, JSON.stringify(newH));
    return filtered.slice(0, 10);
  }

  async function loadNews() {
    var sd = localStorage.getItem(NEWS_DATE_KEY);
    if (sd === getTodayKey()) {
      var s = localStorage.getItem(NEWS_STORAGE_KEY);
      if (s) { try { var p = JSON.parse(s); if (p && p.length > 0) return p; } catch (e) { } }
    }
    var news = await fetchAllNews();
    news = filterPreviouslyShown(news);
    if (news.length > 0) { localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(news)); localStorage.setItem(NEWS_DATE_KEY, getTodayKey()); }
    return news;
  }

  function renderNews(items) {
    var c = document.getElementById('newsScroll');
    c.innerHTML = '';
    if (!items || items.length === 0) { c.innerHTML = '<div class="news-loading">Fetching latest news...</div>'; return; }
    items.forEach(function (item) {
      var el = document.createElement('a');
      el.className = 'news-item'; el.href = item.link; el.target = '_blank'; el.rel = 'noopener noreferrer';
      el.innerHTML = '<span class="news-source">' + escapeHtml(item.source) + '</span><span class="news-title">' + escapeHtml(item.title) + '</span><span class="news-date">' + escapeHtml(item.date) + '</span>';
      c.appendChild(el);
    });
  }

  // ===========================
  // DRAWING BOARD
  // ===========================

  function initDrawingBoard() {
    var canvas = document.getElementById('drawingCanvas');
    var ctx = canvas.getContext('2d');
    var colorPicker = document.getElementById('drawColor');
    var brushSelect = document.getElementById('brushSize');
    var clearBtn = document.getElementById('clearCanvas');

    function resize() {
      var p = canvas.parentElement;
      var tb = p.querySelector('.card-titlebar');
      canvas.width = p.clientWidth;
      canvas.height = p.clientHeight - (tb ? tb.offsetHeight : 38);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    clearBtn.addEventListener('click', function () { ctx.clearRect(0, 0, canvas.width, canvas.height); });

    (function scheduleClear() {
      setTimeout(function () { ctx.clearRect(0, 0, canvas.width, canvas.height); scheduleClear(); }, getMsUntilMidnight() + 500);
    })();
  }

  // ===========================
  // COMMAND OF THE DAY
  // ===========================

  async function renderCOTD() {
    var COTD_KEY = 'plox_cotd_v4', COTD_DATE = 'plox_cotd_date_v4';
    var today = getTodayKey();
    var cotd = null;

    if (localStorage.getItem(COTD_DATE) === today) {
      try { cotd = JSON.parse(localStorage.getItem(COTD_KEY)); } catch (e) { }
    }

    if (!cotd || !cotd.cmd) {
      var cmds = await loadCommandsFile();
      if (cmds.length === 0) cmds = fallbackCommands;
      cotd = cmds[getDayOfYear() % cmds.length];
      localStorage.setItem(COTD_KEY, JSON.stringify(cotd));
      localStorage.setItem(COTD_DATE, today);
    }

    document.getElementById('cotdCommand').textContent = cotd.cmd;
    document.getElementById('cotdDesc').textContent = cotd.desc;

    document.getElementById('cotdCopyBtn').addEventListener('click', function () {
      var btn = document.getElementById('cotdCopyBtn');
      setClipboard(cotd.cmd);
      btn.classList.add('copied');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(function () {
        btn.classList.remove('copied');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 2000);
    });

    setTimeout(function () { renderCOTD(); }, getMsUntilMidnight() + 1000);
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
          localStorage.setItem('plox_pfp', comp);
        };
        tmp.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ===========================
  // DAILY QUOTE
  // ===========================

  async function renderDailyQuote() {
    var QK = 'plox_quote_v5', QD = 'plox_quote_date_v5';
    var container = document.getElementById('dailyQuote');
    container.innerHTML = '<span style="color:rgba(255,255,255,0.12)">...</span>';
    var today = getTodayKey();
    var quote = null;

    if (localStorage.getItem(QD) === today) {
      try { quote = JSON.parse(localStorage.getItem(QK)); } catch (e) { }
    }

    if (!quote || !quote.text) {
      try {
        var r = await fetch(QUOTES_API, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          var data = await r.json();
          var obj = Array.isArray(data) ? data[0] : data;
          if (obj) {
            var t = obj.quote || obj.text || obj.content || obj.q || '';
            var a = obj.author || obj.a || obj.by || 'Unknown';
            if (t) quote = { text: t.trim(), author: a.trim() };
          }
        }
      } catch (e) { }
    }

    if (!quote) quote = { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' };
    localStorage.setItem(QK, JSON.stringify(quote));
    localStorage.setItem(QD, today);

    container.innerHTML = '\u201C' + escapeHtml(quote.text) + '\u201D<span class="quote-author"> by ' + escapeHtml(quote.author) + '</span>';
    setTimeout(function () { renderDailyQuote(); }, getMsUntilMidnight() + 1000);
  }

  // ===========================
  // TERMINAL
  // ===========================

  var CACHE_PREFIX = 'plox_ai_';
  var builtinCommands = {
    help: function () {
      return 'Available commands:\n  help, clear, date, whoami, hostname,\n  uname -a, uptime, pwd, echo, ls\n\nAny other command → AI explanation (' + MAX_DAILY_COMMANDS + '/day).\nCtrl+V to paste.';
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
    if (hasReachedDailyLimit()) terminalLocked = true;

    // Check if token is configured
    if (!HF_TOKEN) {
      var tc = document.getElementById('terminalContent');
      var warnDiv = document.createElement('div');
      warnDiv.className = 'output';
      warnDiv.textContent = '\u26A0\uFE0F  No HF token configured. Edit config.js to add your Hugging Face token.\n    Built-in commands (help, ls, date, etc.) still work.\n';
      var activeLine = document.getElementById('activeLine');
      if (activeLine) tc.insertBefore(warnDiv, activeLine);
    }

    document.addEventListener('keydown', function (e) {
      var act = document.activeElement;
      if (act && (act.tagName === 'INPUT' || act.tagName === 'SELECT' || act.tagName === 'TEXTAREA')) return;
      if (terminalLocked || processingCommand) { if (e.key !== 'F5' && e.key !== 'F12') e.preventDefault(); return; }
      var inp = document.getElementById('input');
      if (!inp) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        var internal = getClipboard();
        if (internal) { currentInput += internal.replace(/[\r\n]+/g, ' ').trim(); inp.textContent = currentInput; scrollToBottom(); }
        else { navigator.clipboard.readText().then(function (t) { if (t) { currentInput += t.replace(/[\r\n]+/g, ' ').trim(); inp.textContent = currentInput; scrollToBottom(); } }).catch(function () { }); }
        return;
      }
      if (e.ctrlKey && e.key === 'c') { e.preventDefault(); freezeLine(currentInput + '^C'); currentInput = ''; newPrompt(); return; }
      if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearTerm(); return; }
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === 'Enter') {
        e.preventDefault(); var cmd = currentInput.trim();
        if (!cmd) { freezeLine(''); newPrompt(); return; }
        commandHistory.push(cmd); historyIndex = commandHistory.length;
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

  async function processCommand(cmd) {
    freezeLine(cmd);
    var al = document.getElementById('activeLine'); if (al) al.remove();
    processingCommand = true;

    if (cmd === 'clear') { processingCommand = false; clearTerm(); return; }
    if (cmd.startsWith('echo ')) { addOutput(cmd.substring(5)); newPrompt(); return; }
    if (builtinCommands[cmd]) { addOutput(builtinCommands[cmd]()); newPrompt(); return; }

    // Check cache
    var cached = localStorage.getItem(CACHE_PREFIX + cmd);
    if (cached) { addOutput(cached); newPrompt(); return; }

    if (hasReachedDailyLimit()) { showLimit(); return; }

    if (!HF_TOKEN) {
      addOutput('\u26A0\uFE0F  No API token configured.\nEdit config.js and add your Hugging Face token to get AI explanations.');
      newPrompt(); return;
    }

    var loader = makeLoader();
    try {
      var r = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HF_TOKEN },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Explain this Linux command clearly:\n\nCommand: ' + cmd + '\n\nFormat:\n\ud83d\udcd8 What it does:\n\ud83d\udd0d Breakdown:\n\ud83d\udca1 When to use:\nKeep under 80 words. Be concise.' }],
          model: AI_MODEL, max_tokens: 150, temperature: 0.3
        })
      });
      if (!r.ok) throw new Error('API error: ' + r.status);
      var data = await r.json();
      var content = data.choices[0].message.content;
      if (loader && loader.parentNode) { clearInterval(loader._interval); loader.remove(); }
      localStorage.setItem(CACHE_PREFIX + cmd, content);
      var count = incrementDailyCommandCount();
      addOutput(content);
      if (count >= MAX_DAILY_COMMANDS) { showLimit(); return; }
      newPrompt();
    } catch (err) {
      if (loader && loader.parentNode) { clearInterval(loader._interval); loader.remove(); }
      addOutput('\u274C Error: ' + err.message);
      newPrompt();
    }
  }

  // ===========================
  // INIT
  // ===========================

  async function init() {
    document.getElementById('newsScroll').innerHTML = '<div class="news-loading">Fetching latest news...</div>';
    initDrawingBoard();
    initProfile();
    initTerminal();
    var newsP = loadNews();
    var cotdP = renderCOTD();
    var quoteP = renderDailyQuote();
    renderNews(await newsP);
    await cotdP;
    await quoteP;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();