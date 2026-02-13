/* ==========================================================
   PICK GAME — Pendulum Grab Game Engine
   Auth + Stages + Backend Integration
   Pure Vanilla JS + Canvas 2D  |  60 fps  |  Zero dependencies
   ========================================================== */
;(function () {
  'use strict';

  /* ---------- API config ---------- */
  var API_BASE = window.location.protocol + '//' + window.location.hostname + ':5000';

  /* ---------- default constants (overridden per stage) ---------- */
  var GAME_DURATION    = 45;
  var PENDULUM_SPEED   = 0.025;
  var MAX_SWING_ANGLE  = 1.1;
  var ARM_EXTEND_SPEED = 14;
  var ARM_RETRACT_SPEED = 16;
  var ITEM_COUNT       = 8;
  var ITEM_MIN_R       = 18;
  var ITEM_MAX_R       = 34;
  var COIN_RATIO       = 0.6;
  var GIFT_CHANCE      = 0.08;
  var GRAB_RADIUS_PAD  = 8;
  var STAR_COUNT       = 80;

  /* ---------- DOM refs ---------- */
  var $authScreen   = document.getElementById('auth-screen');
  var $startScreen  = document.getElementById('start-screen');
  var $gameScreen   = document.getElementById('game-screen');
  var $resultScreen = document.getElementById('result-screen');
  var $lbScreen     = document.getElementById('leaderboard-screen');
  var $canvas       = document.getElementById('game-canvas');
  var $bgCanvas     = document.getElementById('bg-canvas');
  var $authBg       = document.getElementById('auth-bg-canvas');
  var $resultBg     = document.getElementById('result-bg-canvas');
  var $lbBg         = document.getElementById('lb-bg-canvas');

  var $authUsername  = document.getElementById('auth-username');
  var $authPassword  = document.getElementById('auth-password');
  var $authError    = document.getElementById('auth-error');
  var $btnAuth      = document.getElementById('btn-auth');
  var $authToggle   = document.getElementById('auth-toggle');

  var $btnPlay      = document.getElementById('btn-play');
  var $btnRetry     = document.getElementById('btn-retry');
  var $btnHome      = document.getElementById('btn-home');
  var $btnLogout    = document.getElementById('btn-logout');
  var $btnLeaderboard = document.getElementById('btn-leaderboard');
  var $btnLbBack    = document.getElementById('btn-lb-back');
  var $tapHint      = document.getElementById('tap-hint');

  var $hudScore     = document.getElementById('hud-score-val');
  var $hudTimer     = document.getElementById('hud-timer-val');
  var $hudCombo     = document.getElementById('hud-combo');
  var $hudStage     = document.getElementById('hud-stage');
  var $displayUser  = document.getElementById('display-username');
  var $menuBest     = document.getElementById('menu-best');
  var $menuTotal    = document.getElementById('menu-total');
  var $stageGrid    = document.getElementById('stage-grid');

  var $resultTitle  = document.getElementById('result-title');
  var $resultScore  = document.getElementById('result-score');
  var $resultTotal  = document.getElementById('result-total');
  var $statCoins    = document.getElementById('stat-coins');
  var $statBombs    = document.getElementById('stat-bombs');
  var $statCombo    = document.getElementById('stat-combo');
  var $newBest      = document.getElementById('new-best');
  var $stageUnlocked = document.getElementById('stage-unlocked-msg');
  var $lbList       = document.getElementById('lb-list');
  var $floatPool    = document.getElementById('float-pool');

  var ctx = $canvas.getContext('2d');

  /* ---------- auth state ---------- */
  var authToken  = null;
  var currentUser = null;
  var isRegisterMode = false;
  var userBest   = 0;
  var userTotal  = 0;
  var userMaxStage = 1;
  var stages     = [];
  var selectedStage = 1;

  /* ---------- game state ---------- */
  var W, H, dpr;
  var pivotX, pivotY;
  var armAngle = 0, armDir = 1;
  var armLen = 0, armMaxLen = 0;
  var armState = 'idle';
  var armBaseLen = 60;

  var score = 0, combo = 0, maxCombo = 0;
  var coinsGrabbed = 0, bombsHit = 0;
  var bestScore = 0, timeLeft = GAME_DURATION;
  var timerInterval = null, running = false, rafId = null;
  var grabbedItem = null;

  var items = [], particles = [], floats = [], stars = [];

  /* ---------- audio ---------- */
  var audioCtx = null;
  function initAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  function playTone(freq, dur, type, vol) {
    if (!audioCtx) return;
    try {
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.12;
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function sfxGrab()   { playTone(880, 0.12, 'sine', 0.15); playTone(1100, 0.1, 'sine', 0.1); }
  function sfxBomb()   { playTone(150, 0.25, 'sawtooth', 0.12); }
  function sfxGift()   { playTone(660, 0.1, 'sine', 0.12); playTone(880, 0.1, 'sine', 0.1); playTone(1100, 0.12, 'sine', 0.1); }
  function sfxExtend() { playTone(300, 0.08, 'triangle', 0.06); }
  function sfxCombo()  { playTone(1200, 0.15, 'sine', 0.1); }

  /* ---------- haptics ---------- */
  function haptic(style) {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
        window.Capacitor.Plugins.Haptics.impact({ style: style || 'MEDIUM' });
      } else if (navigator.vibrate) {
        navigator.vibrate(style === 'HEAVY' ? 40 : 15);
      }
    } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function dist(x1, y1, x2, y2) { var dx = x1 - x2, dy = y1 - y2; return Math.sqrt(dx * dx + dy * dy); }

  /* ---------- API helpers ---------- */
  function api(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
    if (body) opts.body = JSON.stringify(body);
    return fetch(API_BASE + path, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  /* ============================================================
     AUTH
     ============================================================ */
  function tryAutoLogin() {
    try {
      var saved = localStorage.getItem('pickgame_token');
      var savedUser = localStorage.getItem('pickgame_user');
      if (saved && savedUser) {
        authToken = saved;
        currentUser = savedUser;
        return api('GET', '/api/me').then(function (data) {
          currentUser = data.username;
          userBest = data.best_score;
          userTotal = data.total_score;
          userMaxStage = data.max_stage;
          goToHome();
        }).catch(function () {
          // token expired
          authToken = null;
          currentUser = null;
          localStorage.removeItem('pickgame_token');
          localStorage.removeItem('pickgame_user');
        });
      }
    } catch (e) {}
    return Promise.resolve();
  }

  function doAuth() {
    var username = $authUsername.value.trim();
    var password = $authPassword.value;
    $authError.textContent = '';

    if (!username || username.length < 3) {
      $authError.textContent = 'Username must be at least 3 characters';
      return;
    }
    if (!password || password.length < 4) {
      $authError.textContent = 'Password must be at least 4 characters';
      return;
    }

    $btnAuth.disabled = true;
    var endpoint = isRegisterMode ? '/api/register' : '/api/login';

    api('POST', endpoint, { username: username, password: password })
      .then(function (data) {
        authToken = data.token;
        currentUser = data.username;
        userBest = data.best_score || 0;
        userTotal = data.total_score || 0;
        userMaxStage = data.max_stage || 1;
        try {
          localStorage.setItem('pickgame_token', authToken);
          localStorage.setItem('pickgame_user', currentUser);
        } catch (e) {}
        goToHome();
      })
      .catch(function (err) {
        $authError.textContent = err.message;
      })
      .finally(function () {
        $btnAuth.disabled = false;
      });
  }

  function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    $btnAuth.textContent = isRegisterMode ? 'REGISTER' : 'LOGIN';
    $authToggle.innerHTML = isRegisterMode
      ? 'Already have an account? <span>Login</span>'
      : "Don't have an account? <span>Register</span>";
    $authError.textContent = '';
  }

  function logout() {
    authToken = null;
    currentUser = null;
    try {
      localStorage.removeItem('pickgame_token');
      localStorage.removeItem('pickgame_user');
    } catch (e) {}
    $authUsername.value = '';
    $authPassword.value = '';
    $authError.textContent = '';
    showScreen($authScreen);
    drawStarsBg($authBg);
  }

  /* ============================================================
     STAGES
     ============================================================ */
  function loadStages() {
    return api('GET', '/api/stages').then(function (data) {
      stages = data.stages;
      userTotal = data.total_score;
      renderStageGrid();
    }).catch(function () {
      // fallback stages if backend unreachable
      stages = [
        { stage: 1, name: 'Easy Pickings', unlocked: true, duration: 45, pendulum_speed: 0.025, max_swing: 1.1, coin_ratio: 0.70, gift_chance: 0.10, item_count: 8, required_score: 0 },
        { stage: 2, name: 'Getting Tricky', unlocked: false, duration: 40, pendulum_speed: 0.032, max_swing: 1.2, coin_ratio: 0.60, gift_chance: 0.08, item_count: 9, required_score: 100 },
        { stage: 3, name: 'Speed Demon', unlocked: false, duration: 35, pendulum_speed: 0.040, max_swing: 1.3, coin_ratio: 0.50, gift_chance: 0.06, item_count: 10, required_score: 300 },
        { stage: 4, name: 'Bomb Storm', unlocked: false, duration: 30, pendulum_speed: 0.048, max_swing: 1.35, coin_ratio: 0.40, gift_chance: 0.05, item_count: 11, required_score: 600 },
        { stage: 5, name: 'Master Grab', unlocked: false, duration: 25, pendulum_speed: 0.055, max_swing: 1.4, coin_ratio: 0.35, gift_chance: 0.04, item_count: 12, required_score: 1000 }
      ];
      renderStageGrid();
    });
  }

  function renderStageGrid() {
    $stageGrid.innerHTML = '';
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      var card = document.createElement('div');
      card.className = 'stage-card' + (s.unlocked ? '' : ' locked') + (s.stage === selectedStage ? ' selected' : '');
      card.dataset.stage = s.stage;

      var desc = s.duration + 's';
      if (s.stage > 1) desc += ' | Faster';
      if (s.coin_ratio < 0.5) desc += ' | More bombs';

      card.innerHTML =
        '<div class="stage-num">' + (s.unlocked ? s.stage : '&#128274;') + '</div>' +
        '<div class="stage-info">' +
          '<div class="stage-name">' + s.name + '</div>' +
          (s.unlocked
            ? '<div class="stage-desc">' + desc + '</div>'
            : '<div class="stage-lock">Need ' + s.required_score + ' total pts</div>') +
        '</div>';

      if (s.unlocked) {
        card.addEventListener('click', (function (stageNum) {
          return function () { selectStage(stageNum); };
        })(s.stage));
      }
      $stageGrid.appendChild(card);
    }
  }

  function selectStage(num) {
    selectedStage = num;
    var cards = $stageGrid.querySelectorAll('.stage-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].classList.toggle('selected', parseInt(cards[i].dataset.stage) === num);
    }
  }

  function applyStageConfig() {
    var cfg = null;
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].stage === selectedStage) { cfg = stages[i]; break; }
    }
    if (!cfg) return;
    GAME_DURATION   = cfg.duration;
    PENDULUM_SPEED  = cfg.pendulum_speed;
    MAX_SWING_ANGLE = cfg.max_swing;
    COIN_RATIO      = cfg.coin_ratio;
    GIFT_CHANCE     = cfg.gift_chance;
    ITEM_COUNT      = cfg.item_count;
  }

  /* ============================================================
     LEADERBOARD
     ============================================================ */
  function showLeaderboard() {
    showScreen($lbScreen);
    drawStarsBg($lbBg);
    $lbList.innerHTML = '<div style="color:#8892b0">Loading...</div>';

    api('GET', '/api/leaderboard').then(function (data) {
      var rows = data.leaderboard;
      if (!rows.length) {
        $lbList.innerHTML = '<div style="color:#8892b0">No scores yet. Be the first!</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var medal = i === 0 ? '&#129351;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : (i + 1);
        var isMe = r.username === currentUser;
        html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;margin-bottom:6px;' +
          'background:' + (isMe ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.04)') + '">' +
          '<div style="width:32px;font-size:18px;font-weight:800;text-align:center">' + medal + '</div>' +
          '<div style="flex:1;text-align:left"><div style="font-weight:700;font-size:15px;color:' + (isMe ? '#FFD700' : '#ccd6f6') + '">' + r.username + '</div>' +
          '<div style="font-size:11px;color:#8892b0">Total: ' + r.total_score + '</div></div>' +
          '<div style="font-size:20px;font-weight:900;color:#FFD700">' + r.best_score + '</div>' +
          '</div>';
      }
      $lbList.innerHTML = html;
    }).catch(function () {
      $lbList.innerHTML = '<div style="color:#ff4757">Could not load leaderboard</div>';
    });
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function goToHome() {
    $displayUser.textContent = currentUser;
    $menuBest.textContent = userBest;
    $menuTotal.textContent = userTotal;
    bestScore = userBest;
    loadStages().then(function () {
      showScreen($startScreen);
      drawStarsBg($bgCanvas);
    });
  }

  /* ---------- resize ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    $canvas.width = W * dpr; $canvas.height = H * dpr;
    $canvas.style.width = W + 'px'; $canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pivotX = W / 2; pivotY = 60;
    armMaxLen = H * 0.65;
    armBaseLen = Math.max(40, H * 0.06);
    resizeBgCanvas($bgCanvas); resizeBgCanvas($resultBg);
    resizeBgCanvas($authBg); resizeBgCanvas($lbBg);
    initStars();
  }
  function resizeBgCanvas(c) {
    if (!c) return;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = W + 'px'; c.style.height = H + 'px';
  }

  /* ---------- stars background ---------- */
  function initStars() {
    stars = [];
    for (var i = 0; i < STAR_COUNT; i++) {
      stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 2), a: rand(0.3, 1), s: rand(0.002, 0.008) });
    }
  }
  function drawStarsBg(c) {
    if (!c) return;
    var cx = c.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    var g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0e1a'); g.addColorStop(1, '#141830');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    var t = Date.now() * 0.001;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.s * 600 + i));
      cx.beginPath(); cx.arc(s.x, s.y, s.r, 0, 6.2832);
      cx.fillStyle = 'rgba(255,255,255,' + alpha + ')'; cx.fill();
    }
  }

  /* ---------- items ---------- */
  function spawnItem() {
    var r = rand(ITEM_MIN_R, ITEM_MAX_R);
    var padding = r + 10;
    var minX = padding, maxX = W - padding;
    var minY = H * 0.35, maxY = H * 0.82;
    var x, y, tries = 0;
    do { x = rand(minX, maxX); y = rand(minY, maxY); tries++; } while (tries < 20 && isOverlapping(x, y, r));
    var roll = Math.random(), type;
    if (roll < GIFT_CHANCE) type = 'gift';
    else if (roll < GIFT_CHANCE + COIN_RATIO * (1 - GIFT_CHANCE)) type = 'coin';
    else type = 'bomb';
    items.push({ x: x, y: y, r: r, type: type, alive: true, bobPhase: rand(0, 6.28), bobSpeed: rand(1.5, 3), bobAmp: rand(2, 5), baseY: y, glow: 0 });
  }
  function isOverlapping(x, y, r) {
    for (var i = 0; i < items.length; i++) {
      if (!items[i].alive) continue;
      if (dist(x, y, items[i].x, items[i].y) < r + items[i].r + 10) return true;
    }
    return false;
  }
  function fillItems() {
    var alive = 0;
    for (var i = 0; i < items.length; i++) if (items[i].alive) alive++;
    while (alive < ITEM_COUNT) { spawnItem(); alive++; }
  }

  /* ---------- particles ---------- */
  function emitParticles(x, y, color, count) {
    for (var i = 0; i < count; i++) {
      particles.push({ x: x, y: y, vx: rand(-4, 4), vy: rand(-5, 2), r: rand(2, 5), life: 1, decay: rand(0.02, 0.05), color: color });
    }
  }
  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = p.life; ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, 6.2832);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- float text ---------- */
  function initFloatPool() {
    for (var i = 0; i < 10; i++) {
      var el = document.createElement('div');
      el.className = 'float-text';
      $floatPool.appendChild(el);
      floats.push({ el: el, active: false });
    }
  }
  function showFloat(x, y, text, isPositive) {
    var f = null;
    for (var i = 0; i < floats.length; i++) { if (!floats[i].active) { f = floats[i]; break; } }
    if (!f) return;
    f.active = true; f.el.textContent = text;
    f.el.className = 'float-text ' + (isPositive ? 'plus' : 'minus');
    f.el.style.left = x + 'px'; f.el.style.top = y + 'px';
    f.el.style.opacity = '1'; f.el.style.transform = 'translateY(0)';
    var startTime = Date.now();
    function animateFloat() {
      var progress = (Date.now() - startTime) / 800;
      if (progress >= 1) { f.el.style.opacity = '0'; f.active = false; return; }
      f.el.style.transform = 'translateY(' + (-50 * progress) + 'px)';
      f.el.style.opacity = String(1 - progress);
      requestAnimationFrame(animateFloat);
    }
    requestAnimationFrame(animateFloat);
  }

  /* ---------- drawing helpers ---------- */
  function drawRope(x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#8892b0'; ctx.lineWidth = 3; ctx.stroke();
  }
  function drawClaw(x, y, angle, hasItem) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, 6.2832);
    var grad = ctx.createRadialGradient(0, -3, 2, 0, 0, 14);
    grad.addColorStop(0, '#FFE066'); grad.addColorStop(1, '#FFA000');
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = '#CC8000'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(-16, hasItem ? 18 : 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(16, hasItem ? 18 : 24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, hasItem ? 20 : 26); ctx.stroke();
    ctx.restore();
  }
  function drawPivot() {
    ctx.beginPath(); ctx.arc(pivotX, pivotY, 10, 0, 6.2832);
    var g = ctx.createRadialGradient(pivotX, pivotY - 3, 2, pivotX, pivotY, 10);
    g.addColorStop(0, '#555'); g.addColorStop(1, '#222');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#666'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, pivotY); ctx.lineTo(W, pivotY);
    ctx.strokeStyle = 'rgba(136,146,176,0.3)'; ctx.lineWidth = 2; ctx.stroke();
  }

  function drawItem(item, time) {
    if (!item.alive) return;
    var y = item.baseY + Math.sin(time * item.bobSpeed + item.bobPhase) * item.bobAmp;
    item.y = y;
    ctx.save();
    if (item.type === 'coin') {
      ctx.beginPath(); ctx.arc(item.x, y, item.r + 6, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,215,0,0.1)'; ctx.fill();
      ctx.beginPath(); ctx.arc(item.x, y, item.r, 0, 6.2832);
      var g = ctx.createRadialGradient(item.x - item.r * 0.3, y - item.r * 0.3, item.r * 0.1, item.x, y, item.r);
      g.addColorStop(0, '#FFE066'); g.addColorStop(0.7, '#FFD700'); g.addColorStop(1, '#CC8800');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#B8860B'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#8B6914';
      ctx.font = 'bold ' + Math.round(item.r * 0.9) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', item.x, y + 1);
    } else if (item.type === 'bomb') {
      ctx.beginPath(); ctx.arc(item.x, y, item.r, 0, 6.2832);
      var gb = ctx.createRadialGradient(item.x - item.r * 0.3, y - item.r * 0.3, item.r * 0.1, item.x, y, item.r);
      gb.addColorStop(0, '#4a4a4a'); gb.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = gb; ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#ff4757'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      var s = item.r * 0.4;
      ctx.beginPath(); ctx.moveTo(item.x - s, y - s); ctx.lineTo(item.x + s, y + s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(item.x + s, y - s); ctx.lineTo(item.x - s, y + s); ctx.stroke();
    } else if (item.type === 'gift') {
      var hr = item.r * 0.8;
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(item.x - hr, y - hr, hr * 2, hr * 2);
      ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
      ctx.strokeRect(item.x - hr, y - hr, hr * 2, hr * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(item.x - 3, y - hr, 6, hr * 2);
      ctx.fillRect(item.x - hr, y - 3, hr * 2, 6);
      ctx.beginPath(); ctx.arc(item.x, y - hr, 6, 0, 6.2832);
      ctx.fillStyle = '#FFD700'; ctx.fill();
      ctx.beginPath(); ctx.arc(item.x, y, item.r + 8, 0, 6.2832);
      ctx.fillStyle = 'rgba(231,76,60,0.08)'; ctx.fill();
    }
    ctx.restore();
  }

  function drawGameBg() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0e1a'); g.addColorStop(0.4, '#0f1428'); g.addColorStop(1, '#141830');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var t = Date.now() * 0.001;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var alpha = s.a * (0.5 + 0.5 * Math.sin(t * s.s * 500 + i));
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')'; ctx.fill();
    }
    ctx.beginPath(); ctx.setLineDash([4, 8]);
    ctx.moveTo(0, H * 0.33); ctx.lineTo(W, H * 0.33);
    ctx.strokeStyle = 'rgba(136,146,176,0.08)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ---------- game loop ---------- */
  function getClawTip() {
    var totalLen = armBaseLen + armLen;
    return { x: pivotX + Math.sin(armAngle) * totalLen, y: pivotY + Math.cos(armAngle) * totalLen };
  }
  function checkCollision(tip) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.alive) continue;
      if (dist(tip.x, tip.y, it.x, it.y) < it.r + GRAB_RADIUS_PAD) return it;
    }
    return null;
  }

  function processGrab(item) {
    grabbedItem = item; item.alive = false; armState = 'retracting';
    var points;
    if (item.type === 'coin') {
      var sizeRatio = (item.r - ITEM_MIN_R) / (ITEM_MAX_R - ITEM_MIN_R);
      points = Math.round(10 + sizeRatio * 40);
      combo++; if (combo > maxCombo) maxCombo = combo;
      if (combo >= 3) {
        points = Math.round(points * (1 + combo * 0.15));
        $hudCombo.textContent = combo + 'x COMBO!';
        $hudCombo.classList.add('show'); sfxCombo();
      }
      score += points; coinsGrabbed++;
      emitParticles(item.x, item.y, '#FFD700', 12);
      showFloat(item.x, item.y - 20, '+' + points, true);
      sfxGrab(); haptic('LIGHT');
    } else if (item.type === 'bomb') {
      var sizeRatio2 = (item.r - ITEM_MIN_R) / (ITEM_MAX_R - ITEM_MIN_R);
      points = Math.round(10 + sizeRatio2 * 30);
      score = Math.max(0, score - points); combo = 0; bombsHit++;
      $hudCombo.classList.remove('show');
      emitParticles(item.x, item.y, '#ff4757', 15);
      showFloat(item.x, item.y - 20, '-' + points, false);
      sfxBomb(); haptic('HEAVY');
    } else if (item.type === 'gift') {
      points = randInt(30, 80); combo++;
      if (combo > maxCombo) maxCombo = combo;
      score += points; coinsGrabbed++;
      emitParticles(item.x, item.y, '#e74c3c', 8);
      emitParticles(item.x, item.y, '#FFD700', 8);
      showFloat(item.x, item.y - 20, '+' + points + ' GIFT!', true);
      sfxGift(); haptic('MEDIUM');
    }
    $hudScore.textContent = score;
  }

  function update() {
    var time = Date.now() * 0.001;
    if (armState === 'idle') {
      armAngle += PENDULUM_SPEED * armDir;
      if (armAngle > MAX_SWING_ANGLE) { armAngle = MAX_SWING_ANGLE; armDir = -1; }
      if (armAngle < -MAX_SWING_ANGLE) { armAngle = -MAX_SWING_ANGLE; armDir = 1; }
    }
    if (armState === 'extending') {
      armLen += ARM_EXTEND_SPEED;
      var tip = getClawTip();
      var hit = checkCollision(tip);
      if (hit) { processGrab(hit); }
      else if (armLen >= armMaxLen || tip.y >= H * 0.88) {
        armState = 'retracting'; combo = 0; $hudCombo.classList.remove('show');
      }
    }
    if (armState === 'retracting') {
      armLen -= ARM_RETRACT_SPEED;
      if (armLen <= 0) { armLen = 0; armState = 'idle'; grabbedItem = null; fillItems(); }
    }
    updateParticles(); draw(time);
    if (running) rafId = requestAnimationFrame(update);
  }

  function draw(time) {
    ctx.clearRect(0, 0, W, H); drawGameBg();
    for (var i = 0; i < items.length; i++) drawItem(items[i], time);
    if (grabbedItem && armState === 'retracting') {
      var tip = getClawTip();
      grabbedItem.x = tip.x; grabbedItem.baseY = tip.y; grabbedItem.y = tip.y;
      var retractRatio = armLen / armMaxLen;
      var origR = grabbedItem.r;
      grabbedItem.r = origR * (0.4 + 0.6 * retractRatio);
      drawItem(grabbedItem, time); grabbedItem.r = origR;
    }
    var tip2 = getClawTip();
    drawRope(pivotX, pivotY, tip2.x, tip2.y);
    drawClaw(tip2.x, tip2.y, 0, grabbedItem != null);
    drawPivot(); drawParticles();
  }

  /* ---------- timer ---------- */
  function startTimer() {
    timeLeft = GAME_DURATION;
    $hudTimer.textContent = timeLeft;
    $hudTimer.classList.remove('urgent');
    timerInterval = setInterval(function () {
      timeLeft--; $hudTimer.textContent = timeLeft;
      if (timeLeft <= 10) $hudTimer.classList.add('urgent');
      if (timeLeft <= 0) endGame();
    }, 1000);
  }

  /* ---------- screens ---------- */
  function showScreen(screen) {
    var allScreens = [$authScreen, $startScreen, $gameScreen, $resultScreen, $lbScreen];
    for (var i = 0; i < allScreens.length; i++) allScreens[i].classList.remove('active');
    screen.classList.add('active');
  }

  function startGame() {
    initAudio();
    applyStageConfig();
    showScreen($gameScreen);

    score = 0; combo = 0; maxCombo = 0; coinsGrabbed = 0; bombsHit = 0;
    armAngle = 0; armDir = 1; armLen = 0; armState = 'idle';
    grabbedItem = null; items = []; particles = [];

    $hudScore.textContent = '0';
    $hudCombo.classList.remove('show');
    $tapHint.style.display = '';
    $tapHint.style.opacity = '';

    // show stage name in HUD
    var stageName = '';
    for (var i = 0; i < stages.length; i++) {
      if (stages[i].stage === selectedStage) { stageName = stages[i].name; break; }
    }
    $hudStage.textContent = 'Stage ' + selectedStage + ': ' + stageName;

    fillItems(); running = true; startTimer(); update();
    setTimeout(function () { $tapHint.style.opacity = '0'; }, 3000);
  }

  function endGame() {
    running = false; clearInterval(timerInterval);
    if (rafId) cancelAnimationFrame(rafId);

    // submit score to backend
    var oldMaxStage = userMaxStage;
    api('POST', '/api/scores', {
      stage: selectedStage,
      score: score,
      coins: coinsGrabbed,
      bombs: bombsHit,
      max_combo: maxCombo
    }).then(function (data) {
      var isNewBest = data.is_new_best;
      userBest = data.best_score;
      userTotal = data.total_score;
      userMaxStage = data.max_stage;
      bestScore = userBest;

      showResultScreen(isNewBest, data.max_stage > oldMaxStage ? data.max_stage : 0);
    }).catch(function () {
      // offline fallback
      var isNewBest = score > bestScore;
      if (isNewBest) bestScore = score;
      showResultScreen(isNewBest, 0);
    });
  }

  function showResultScreen(isNewBest, newlyUnlockedStage) {
    setTimeout(function () {
      $resultScore.textContent = score;
      $statCoins.textContent = coinsGrabbed;
      $statBombs.textContent = bombsHit;
      $statCombo.textContent = maxCombo;
      $menuBest.textContent = bestScore;
      $menuTotal.textContent = userTotal;

      if (userTotal > 0) {
        $resultTotal.textContent = 'Total Score: ' + userTotal;
        $resultTotal.classList.remove('hidden');
      } else {
        $resultTotal.classList.add('hidden');
      }

      if (isNewBest && score > 0) {
        $newBest.classList.remove('hidden');
        $resultTitle.textContent = 'Amazing!';
      } else {
        $newBest.classList.add('hidden');
        $resultTitle.textContent = "Time's Up!";
      }

      if (newlyUnlockedStage > 0) {
        var sName = '';
        for (var i = 0; i < stages.length; i++) {
          if (stages[i].stage === newlyUnlockedStage) { sName = stages[i].name; break; }
        }
        $stageUnlocked.textContent = 'Stage ' + newlyUnlockedStage + ' Unlocked: ' + sName + '!';
        $stageUnlocked.classList.remove('hidden');
      } else {
        $stageUnlocked.classList.add('hidden');
      }

      showScreen($resultScreen);
      drawStarsBg($resultBg);
    }, 400);
  }

  /* ---------- input ---------- */
  function onTap(e) {
    e.preventDefault();
    if (!running) return;
    if (armState !== 'idle') return;
    armState = 'extending'; sfxExtend(); haptic('LIGHT');
  }

  // tap anywhere on screen to grab
  document.addEventListener('touchstart', function (e) {
    if (!running) return;
    onTap(e);
  }, { passive: false });
  document.addEventListener('mousedown', function (e) {
    if (!running) return;
    onTap(e);
  });

  /* ---------- button events ---------- */
  $btnAuth.addEventListener('click', doAuth);
  $authToggle.addEventListener('click', toggleAuthMode);
  $authPassword.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doAuth();
  });

  $btnPlay.addEventListener('click', function () { startGame(); });
  $btnRetry.addEventListener('click', function () { startGame(); });
  $btnHome.addEventListener('click', function () { goToHome(); });
  $btnLogout.addEventListener('click', function () { logout(); });
  $btnLeaderboard.addEventListener('click', function () { showLeaderboard(); });
  $btnLbBack.addEventListener('click', function () { goToHome(); });

  /* ---------- init ---------- */
  function init() {
    resize();
    initFloatPool();
    drawStarsBg($authBg);

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
    document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    // try auto-login
    tryAutoLogin();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
