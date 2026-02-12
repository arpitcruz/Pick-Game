/* ==========================================================
   PICK GAME — Pendulum Grab Game Engine
   Pure Vanilla JS + Canvas 2D  |  60 fps  |  Zero dependencies
   ========================================================== */
;(function () {
  'use strict';

  /* ---------- constants ---------- */
  var GAME_DURATION   = 45;          // seconds
  var PENDULUM_SPEED  = 0.025;       // radians per frame (~60fps)
  var MAX_SWING_ANGLE = 1.1;         // radians from center
  var ARM_EXTEND_SPEED = 14;         // px per frame
  var ARM_RETRACT_SPEED = 16;
  var ITEM_COUNT       = 8;          // items on field at once
  var ITEM_MIN_R       = 18;
  var ITEM_MAX_R       = 34;
  var COIN_RATIO       = 0.6;        // 60% coins, 40% bombs
  var GIFT_CHANCE      = 0.08;       // 8% chance of gift box
  var GRAB_RADIUS_PAD  = 8;          // extra collision radius
  var STAR_COUNT       = 80;

  /* ---------- DOM refs ---------- */
  var $startScreen  = document.getElementById('start-screen');
  var $gameScreen   = document.getElementById('game-screen');
  var $resultScreen = document.getElementById('result-screen');
  var $canvas       = document.getElementById('game-canvas');
  var $bgCanvas     = document.getElementById('bg-canvas');
  var $resultBg     = document.getElementById('result-bg-canvas');
  var $btnPlay      = document.getElementById('btn-play');
  var $btnRetry     = document.getElementById('btn-retry');
  var $btnHome      = document.getElementById('btn-home');
  var $tapZone      = document.getElementById('tap-zone');
  var $tapHint      = document.getElementById('tap-hint');
  var $hudScore     = document.getElementById('hud-score-val');
  var $hudTimer     = document.getElementById('hud-timer-val');
  var $hudCombo     = document.getElementById('hud-combo');
  var $menuBest     = document.getElementById('menu-best');
  var $resultTitle  = document.getElementById('result-title');
  var $resultScore  = document.getElementById('result-score');
  var $statCoins    = document.getElementById('stat-coins');
  var $statBombs    = document.getElementById('stat-bombs');
  var $statCombo    = document.getElementById('stat-combo');
  var $newBest      = document.getElementById('new-best');
  var $floatPool    = document.getElementById('float-pool');

  var ctx = $canvas.getContext('2d');

  /* ---------- state ---------- */
  var W, H, dpr;
  var pivotX, pivotY;             // pendulum pivot point
  var armAngle = 0;               // current swing angle
  var armDir   = 1;               // 1 = swinging right, -1 = left
  var armLen   = 0;               // current extended length
  var armMaxLen = 0;              // max possible extension
  var armState = 'idle';          // idle | extending | retracting | grabbed
  var armBaseLen = 60;            // rope from pivot to claw (resting)

  var score = 0;
  var combo = 0;
  var maxCombo = 0;
  var coinsGrabbed = 0;
  var bombsHit = 0;
  var bestScore = 0;
  var timeLeft = GAME_DURATION;
  var timerInterval = null;
  var running = false;
  var rafId = null;
  var grabbedItem = null;

  /* ---------- object pools ---------- */
  var items     = [];              // active items on field
  var particles = [];              // particle pool
  var floats    = [];              // floating text DOM elements pool
  var stars     = [];              // background stars

  /* ---------- audio (Web Audio API — tiny synth, no files needed) ---------- */
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
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }
  function sfxGrab()  { playTone(880, 0.12, 'sine', 0.15); playTone(1100, 0.1, 'sine', 0.1); }
  function sfxBomb()  { playTone(150, 0.25, 'sawtooth', 0.12); }
  function sfxGift()  { playTone(660, 0.1, 'sine', 0.12); playTone(880, 0.1, 'sine', 0.1); playTone(1100, 0.12, 'sine', 0.1); }
  function sfxExtend(){ playTone(300, 0.08, 'triangle', 0.06); }
  function sfxCombo() { playTone(1200, 0.15, 'sine', 0.1); }

  /* ---------- haptics (Capacitor if available) ---------- */
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
  function dist(x1, y1, x2, y2) {
    var dx = x1 - x2, dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- resize ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    $canvas.width  = W * dpr;
    $canvas.height = H * dpr;
    $canvas.style.width  = W + 'px';
    $canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    pivotX = W / 2;
    pivotY = 60;
    armMaxLen = H * 0.65;
    armBaseLen = Math.max(40, H * 0.06);

    resizeBgCanvas($bgCanvas);
    resizeBgCanvas($resultBg);
    initStars();
  }
  function resizeBgCanvas(c) {
    if (!c) return;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
  }

  /* ---------- stars background ---------- */
  function initStars() {
    stars = [];
    for (var i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: rand(0, W), y: rand(0, H),
        r: rand(0.5, 2),
        a: rand(0.3, 1),
        s: rand(0.002, 0.008)
      });
    }
  }
  function drawStarsBg(c) {
    if (!c) return;
    var cx = c.getContext('2d');
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    // gradient bg
    var g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0e1a');
    g.addColorStop(1, '#141830');
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    // stars
    var t = Date.now() * 0.001;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.s * 600 + i));
      cx.beginPath();
      cx.arc(s.x, s.y, s.r, 0, 6.2832);
      cx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      cx.fill();
    }
  }

  /* ---------- items ---------- */
  function spawnItem() {
    var r = rand(ITEM_MIN_R, ITEM_MAX_R);
    var padding = r + 10;
    var minX = padding;
    var maxX = W - padding;
    // Items appear in the lower 55% of screen
    var minY = H * 0.35;
    var maxY = H * 0.82;
    var x, y, tries = 0;
    // avoid overlaps
    do {
      x = rand(minX, maxX);
      y = rand(minY, maxY);
      tries++;
    } while (tries < 20 && isOverlapping(x, y, r));

    var roll = Math.random();
    var type;
    if (roll < GIFT_CHANCE) {
      type = 'gift';
    } else if (roll < GIFT_CHANCE + COIN_RATIO * (1 - GIFT_CHANCE)) {
      type = 'coin';
    } else {
      type = 'bomb';
    }

    items.push({
      x: x, y: y, r: r,
      type: type,
      alive: true,
      bobPhase: rand(0, 6.28),
      bobSpeed: rand(1.5, 3),
      bobAmp: rand(2, 5),
      baseY: y,
      glow: 0
    });
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
      particles.push({
        x: x, y: y,
        vx: rand(-4, 4),
        vy: rand(-5, 2),
        r: rand(2, 5),
        life: 1,
        decay: rand(0.02, 0.05),
        color: color
      });
    }
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15; // gravity
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, 6.2832);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- float text (DOM pool for perf) ---------- */
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
    for (var i = 0; i < floats.length; i++) {
      if (!floats[i].active) { f = floats[i]; break; }
    }
    if (!f) return;
    f.active = true;
    f.el.textContent = text;
    f.el.className = 'float-text ' + (isPositive ? 'plus' : 'minus');
    f.el.style.left = x + 'px';
    f.el.style.top  = y + 'px';
    f.el.style.opacity = '1';
    f.el.style.transform = 'translateY(0)';

    var startTime = Date.now();
    function animateFloat() {
      var elapsed = Date.now() - startTime;
      var progress = elapsed / 800;
      if (progress >= 1) {
        f.el.style.opacity = '0';
        f.active = false;
        return;
      }
      f.el.style.transform = 'translateY(' + (-50 * progress) + 'px)';
      f.el.style.opacity = String(1 - progress);
      requestAnimationFrame(animateFloat);
    }
    requestAnimationFrame(animateFloat);
  }

  /* ---------- drawing helpers ---------- */
  function drawRope(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = '#8892b0';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawClaw(x, y, angle, hasItem) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // claw body
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, 6.2832);
    var grad = ctx.createRadialGradient(0, -3, 2, 0, 0, 14);
    grad.addColorStop(0, '#FFE066');
    grad.addColorStop(1, '#FFA000');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#CC8000';
    ctx.lineWidth = 2;
    ctx.stroke();

    // left prong
    ctx.beginPath();
    ctx.moveTo(-8, 8);
    ctx.lineTo(-16, hasItem ? 18 : 24);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // right prong
    ctx.beginPath();
    ctx.moveTo(8, 8);
    ctx.lineTo(16, hasItem ? 18 : 24);
    ctx.stroke();

    // center prong
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(0, hasItem ? 20 : 26);
    ctx.stroke();

    ctx.restore();
  }

  function drawPivot() {
    // pivot mount
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 10, 0, 6.2832);
    var g = ctx.createRadialGradient(pivotX, pivotY - 3, 2, pivotX, pivotY, 10);
    g.addColorStop(0, '#555');
    g.addColorStop(1, '#222');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.stroke();

    // rail across top
    ctx.beginPath();
    ctx.moveTo(0, pivotY);
    ctx.lineTo(W, pivotY);
    ctx.strokeStyle = 'rgba(136,146,176,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawItem(item, time) {
    if (!item.alive) return;
    var y = item.baseY + Math.sin(time * item.bobSpeed + item.bobPhase) * item.bobAmp;
    item.y = y;

    ctx.save();
    if (item.type === 'coin') {
      // glow
      ctx.beginPath();
      ctx.arc(item.x, y, item.r + 6, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,215,0,0.1)';
      ctx.fill();
      // body
      ctx.beginPath();
      ctx.arc(item.x, y, item.r, 0, 6.2832);
      var g = ctx.createRadialGradient(item.x - item.r * 0.3, y - item.r * 0.3, item.r * 0.1, item.x, y, item.r);
      g.addColorStop(0, '#FFE066');
      g.addColorStop(0.7, '#FFD700');
      g.addColorStop(1, '#CC8800');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#B8860B';
      ctx.lineWidth = 2;
      ctx.stroke();
      // dollar sign
      ctx.fillStyle = '#8B6914';
      ctx.font = 'bold ' + Math.round(item.r * 0.9) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', item.x, y + 1);
    } else if (item.type === 'bomb') {
      // body
      ctx.beginPath();
      ctx.arc(item.x, y, item.r, 0, 6.2832);
      var gb = ctx.createRadialGradient(item.x - item.r * 0.3, y - item.r * 0.3, item.r * 0.1, item.x, y, item.r);
      gb.addColorStop(0, '#4a4a4a');
      gb.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = gb;
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.stroke();
      // X mark
      ctx.strokeStyle = '#ff4757';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      var s = item.r * 0.4;
      ctx.beginPath();
      ctx.moveTo(item.x - s, y - s);
      ctx.lineTo(item.x + s, y + s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(item.x + s, y - s);
      ctx.lineTo(item.x - s, y + s);
      ctx.stroke();
    } else if (item.type === 'gift') {
      // gift box
      var hr = item.r * 0.8;
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(item.x - hr, y - hr, hr * 2, hr * 2);
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x - hr, y - hr, hr * 2, hr * 2);
      // ribbon
      ctx.fillStyle = '#FFD700';
      ctx.fillRect(item.x - 3, y - hr, 6, hr * 2);
      ctx.fillRect(item.x - hr, y - 3, hr * 2, 6);
      // bow
      ctx.beginPath();
      ctx.arc(item.x, y - hr, 6, 0, 6.2832);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      // glow
      ctx.beginPath();
      ctx.arc(item.x, y, item.r + 8, 0, 6.2832);
      ctx.fillStyle = 'rgba(231,76,60,0.08)';
      ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- game background ---------- */
  function drawGameBg() {
    // dark gradient
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0e1a');
    g.addColorStop(0.4, '#0f1428');
    g.addColorStop(1, '#141830');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    var t = Date.now() * 0.001;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var alpha = s.a * (0.5 + 0.5 * Math.sin(t * s.s * 500 + i));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fill();
    }

    // zone line (where items float)
    ctx.beginPath();
    ctx.setLineDash([4, 8]);
    ctx.moveTo(0, H * 0.33);
    ctx.lineTo(W, H * 0.33);
    ctx.strokeStyle = 'rgba(136,146,176,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ---------- main game loop ---------- */
  function getClawTip() {
    var totalLen = armBaseLen + armLen;
    var cx = pivotX + Math.sin(armAngle) * totalLen;
    var cy = pivotY + Math.cos(armAngle) * totalLen;
    return { x: cx, y: cy };
  }

  function checkCollision(tip) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.alive) continue;
      if (dist(tip.x, tip.y, it.x, it.y) < it.r + GRAB_RADIUS_PAD) {
        return it;
      }
    }
    return null;
  }

  function processGrab(item) {
    grabbedItem = item;
    item.alive = false;
    armState = 'retracting';

    var points;
    if (item.type === 'coin') {
      // score based on size — bigger = more points
      var sizeRatio = (item.r - ITEM_MIN_R) / (ITEM_MAX_R - ITEM_MIN_R);
      points = Math.round(10 + sizeRatio * 40); // 10-50 points
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      if (combo >= 3) {
        points = Math.round(points * (1 + combo * 0.15));
        $hudCombo.textContent = combo + 'x COMBO!';
        $hudCombo.classList.add('show');
        sfxCombo();
      }
      score += points;
      coinsGrabbed++;
      emitParticles(item.x, item.y, '#FFD700', 12);
      showFloat(item.x, item.y - 20, '+' + points, true);
      sfxGrab();
      haptic('LIGHT');
    } else if (item.type === 'bomb') {
      var sizeRatio2 = (item.r - ITEM_MIN_R) / (ITEM_MAX_R - ITEM_MIN_R);
      points = Math.round(10 + sizeRatio2 * 30);
      score = Math.max(0, score - points);
      combo = 0;
      bombsHit++;
      $hudCombo.classList.remove('show');
      emitParticles(item.x, item.y, '#ff4757', 15);
      showFloat(item.x, item.y - 20, '-' + points, false);
      sfxBomb();
      haptic('HEAVY');
    } else if (item.type === 'gift') {
      points = randInt(30, 80);
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      score += points;
      coinsGrabbed++;
      emitParticles(item.x, item.y, '#e74c3c', 8);
      emitParticles(item.x, item.y, '#FFD700', 8);
      showFloat(item.x, item.y - 20, '+' + points + ' GIFT!', true);
      sfxGift();
      haptic('MEDIUM');
    }
    $hudScore.textContent = score;
  }

  function update() {
    var time = Date.now() * 0.001;

    // pendulum swing
    if (armState === 'idle') {
      armAngle += PENDULUM_SPEED * armDir;
      if (armAngle > MAX_SWING_ANGLE) { armAngle = MAX_SWING_ANGLE; armDir = -1; }
      if (armAngle < -MAX_SWING_ANGLE) { armAngle = -MAX_SWING_ANGLE; armDir = 1; }
    }

    // arm extension
    if (armState === 'extending') {
      armLen += ARM_EXTEND_SPEED;
      var tip = getClawTip();
      var hit = checkCollision(tip);
      if (hit) {
        processGrab(hit);
      } else if (armLen >= armMaxLen || tip.y >= H * 0.88) {
        armState = 'retracting';
        combo = 0;
        $hudCombo.classList.remove('show');
      }
    }

    // arm retraction
    if (armState === 'retracting') {
      armLen -= ARM_RETRACT_SPEED;
      if (armLen <= 0) {
        armLen = 0;
        armState = 'idle';
        grabbedItem = null;
        fillItems(); // replenish
      }
    }

    // update particles
    updateParticles();

    // draw
    draw(time);

    if (running) {
      rafId = requestAnimationFrame(update);
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, W, H);
    drawGameBg();

    // items
    for (var i = 0; i < items.length; i++) {
      drawItem(items[i], time);
    }

    // grabbed item moves with claw
    if (grabbedItem && armState === 'retracting') {
      var tip = getClawTip();
      grabbedItem.x = tip.x;
      grabbedItem.baseY = tip.y;
      grabbedItem.y = tip.y;
      // draw it smaller as it retracts (visual feedback)
      var retractRatio = armLen / armMaxLen;
      var origR = grabbedItem.r;
      grabbedItem.r = origR * (0.4 + 0.6 * retractRatio);
      drawItem(grabbedItem, time);
      grabbedItem.r = origR;
    }

    // rope + claw
    var tip = getClawTip();
    drawRope(pivotX, pivotY, tip.x, tip.y);
    drawClaw(tip.x, tip.y, armAngle, grabbedItem != null);
    drawPivot();

    // particles on top
    drawParticles();
  }

  /* ---------- timer ---------- */
  function startTimer() {
    timeLeft = GAME_DURATION;
    $hudTimer.textContent = timeLeft;
    $hudTimer.classList.remove('urgent');
    timerInterval = setInterval(function () {
      timeLeft--;
      $hudTimer.textContent = timeLeft;
      if (timeLeft <= 10) $hudTimer.classList.add('urgent');
      if (timeLeft <= 0) {
        endGame();
      }
    }, 1000);
  }

  /* ---------- screens ---------- */
  function showScreen(screen) {
    $startScreen.classList.remove('active');
    $gameScreen.classList.remove('active');
    $resultScreen.classList.remove('active');
    screen.classList.add('active');
  }

  function startGame() {
    initAudio();
    showScreen($gameScreen);

    // reset state
    score = 0;
    combo = 0;
    maxCombo = 0;
    coinsGrabbed = 0;
    bombsHit = 0;
    armAngle = 0;
    armDir = 1;
    armLen = 0;
    armState = 'idle';
    grabbedItem = null;
    items = [];
    particles = [];

    $hudScore.textContent = '0';
    $hudCombo.classList.remove('show');
    $tapHint.style.display = '';

    fillItems();
    running = true;
    startTimer();
    update();

    // hide tap hint after first tap
    setTimeout(function () { $tapHint.style.opacity = '0'; }, 3000);
  }

  function endGame() {
    running = false;
    clearInterval(timerInterval);
    if (rafId) cancelAnimationFrame(rafId);

    // update best
    var isNewBest = false;
    if (score > bestScore) {
      bestScore = score;
      isNewBest = true;
      try { localStorage.setItem('pickgame_best', bestScore); } catch (e) {}
    }

    // show results
    setTimeout(function () {
      $resultScore.textContent = score;
      $statCoins.textContent = coinsGrabbed;
      $statBombs.textContent = bombsHit;
      $statCombo.textContent = maxCombo;
      $menuBest.textContent = bestScore;

      if (isNewBest && score > 0) {
        $newBest.classList.remove('hidden');
        $resultTitle.textContent = 'Amazing!';
      } else {
        $newBest.classList.add('hidden');
        $resultTitle.textContent = "Time's Up!";
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
    armState = 'extending';
    sfxExtend();
    haptic('LIGHT');
  }

  $tapZone.addEventListener('touchstart', onTap, { passive: false });
  $tapZone.addEventListener('mousedown', onTap);

  // also allow tapping anywhere on canvas
  $canvas.addEventListener('touchstart', onTap, { passive: false });
  $canvas.addEventListener('mousedown', onTap);

  /* ---------- buttons ---------- */
  $btnPlay.addEventListener('click', function () { startGame(); });
  $btnRetry.addEventListener('click', function () { startGame(); });
  $btnHome.addEventListener('click', function () {
    showScreen($startScreen);
    drawStarsBg($bgCanvas);
    $menuBest.textContent = bestScore;
  });

  /* ---------- init ---------- */
  function init() {
    // load best score
    try { bestScore = parseInt(localStorage.getItem('pickgame_best')) || 0; } catch (e) {}
    $menuBest.textContent = bestScore;

    resize();
    initFloatPool();
    drawStarsBg($bgCanvas);

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () {
      setTimeout(resize, 200);
    });

    // prevent pull-to-refresh / overscroll
    document.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
  }

  // start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
