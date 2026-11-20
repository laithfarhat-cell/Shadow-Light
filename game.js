/**
 * ============================================================================
 * SHADOW & LIGHT — Zero-Dependency HTML5 Canvas 2D Raycast Puzzle Game
 * ============================================================================
 * Features:
 * - Real-time 2D visibility polygon / shadow-casting engine with merged wall edges
 * - Deterministic `isPointLit(x, y)` line-of-sight & radial illumination solver
 * - Dynamic Light Orb mechanic (Carry / Anchor / Recall via Space)
 * - Interactive Shadow Bridges (Cyan) & Light-Sensitive Sentries (Crimson)
 * - 5 progressive, mathematically verified puzzle chambers + modular `LEVELS`
 * - Atmospheric 60 FPS rendering, High-DPI support, and procedural particles
 * ============================================================================
 */

(() => {
  "use strict";

  // --------------------------------------------------------------------------
  // Core Constants & Configuration
  // --------------------------------------------------------------------------
  const LOGICAL_WIDTH = 960;
  const LOGICAL_HEIGHT = 560;
  const TILE = 40;
  const COLS = 24; // 24 * 40 = 960
  const ROWS = 14; // 14 * 40 = 560

  const PLAYER_RADIUS = 11;
  const PLAYER_MAX_SPEED = 210;
  const PLAYER_ACCEL = 1800;
  const PLAYER_FRICTION = 14;

  const TRAP_LETHAL_RADIUS = 8.5;
  const PORTAL_RADIUS = 18;
  const RAY_EPSILON = 0.00014;

  // --------------------------------------------------------------------------
  // Modular Level Definitions (GitHub Contributor Friendly)
  // --------------------------------------------------------------------------
  // Legend:
  //   '#' : Solid Wall (blocks player movement & light rays; casts shadows)
  //   '.' : Stone Floor (walkable)
  //   '~' : Abyss / Chasm (impassable pit; light rays shine freely across)
  //   '=' : Shadow Bridge [Cyan] (solid & walkable ONLY when illuminated)
  //   '^' : Light-Sensitive Sentry [Crimson] (lethal ONLY when illuminated)
  //   'S' : Player Spawn (starts carrying the Light Orb)
  //   'E' : Exit Portal [Gold] (advances to next level)
  //   '*' : Etched Floor Rune (walkable floor with subtle visual hint ring)
  // --------------------------------------------------------------------------
  const LEVELS = [
    {
      id: 1,
      name: "Chamber of Whispers",
      hint: "Move with WASD or Arrow Keys. Navigate the dark halls to reach the Gold Portal.",
      lightRadius: 290,
      grid: [
        "########################",
        "#..........##..........#",
        "#..####....##....####..#",
        "#..#...............#...#",
        "#..#...####..####..#...#",
        "#......#........#......#",
        "#..S...#...##...#......#",
        "#......#...##..........#",
        "#..#.......#....#####..#",
        "#..#####...#........#..#",
        "#..........######...#..#",
        "#...............#...E..#",
        "#...............#......#",
        "########################"
      ]
    },
    {
      id: 2,
      name: "Bridges of Cyan Mist",
      hint: "Cyan Bridges solidify ONLY in light. Press SPACE near a gap to anchor or recall your Orb.",
      lightRadius: 250,
      grid: [
        "########################",
        "#.....~~~~....~~~~.....#",
        "#.##..~~~~.##.~~~~..##.#",
        "#.##..~~~~.##.~~~~..##.#",
        "#.....~~~~....~~~~.....#",
        "#.....~~~~....~~~~.....#",
        "#..S.*====..*.====..E..#",
        "#.....====....====.....#",
        "#.....~~~~....~~~~.....#",
        "#.....~~~~....~~~~.....#",
        "#.##..~~~~.##.~~~~..##.#",
        "#.##..~~~~.##.~~~~..##.#",
        "#.....~~~~....~~~~.....#",
        "########################"
      ]
    },
    {
      id: 3,
      name: "Crimson Gaze",
      hint: "Crimson Sentries activate in light! Press SPACE behind a wall to hide them in shadow.",
      lightRadius: 540,
      grid: [
        "########################",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "#~~~........~~~~~~~~~~~#",
        "#~~~........~~~~.....~~#",
        "#~~~....##..~~~~.....~~#",
        "#~~~....##..^^^^.....~~#",
        "#~~~.S.*##..^^^^..E..~~#",
        "#~~~....##..^^^^.....~~#",
        "#~~~....##..~~~~.....~~#",
        "#~~~........~~~~.....~~#",
        "#~~~........~~~~~~~~~~~#",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "########################"
      ]
    },
    {
      id: 4,
      name: "The Split Beam",
      hint: null,
      lightRadius: 520,
      grid: [
        "########################",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "#~~~~.....~~~~.....~~~~#",
        "#~~~~.S...====.....~~~~#",
        "#~~~~.....====.....~~~~#",
        "#~~~~.....~~~~.....~~~~#",
        "#~~~~.....~~~~.....~~~~#",
        "#~~~~....#~~~~~^^~~~~~~#",
        "#~~~~....#~~~~~^^~~~~~~#",
        "#~~~~....#~~~~......~~~#",
        "#~~~~....#~~~~....E.~~~#",
        "#~~~~~~~~~~~~~~~~~~~~~~#",
        "########################"
      ]
    },
    {
      id: 5,
      name: "Sanctum of Eclipse",
      hint: null,
      lightRadius: 365,
      grid: [
        "########################",
        "#....~~~~....~~~~......#",
        "#.S..~~~~....===......~#",
        "#....~~~~....===......~#",
        "#...#~~~~...#~~~......~#",
        "#...#~~~~~^^#~~~~~^^~~~#",
        "#....~~~~~^^~~~~~~^^~~~#",
        "#....~~~~....~~~~......#",
        "#....===.....~~~~......#",
        "#....===.....~~~==..####",
        "#....~~~~...~~~~==~~~~~#",
        "#~~~~~~~~~~~.......^^E.#",
        "#~~~~~~~~~~~.......^^..#",
        "########################"
      ]
    }
  ];

  // --------------------------------------------------------------------------
  // Math & Geometry Utilities
  // --------------------------------------------------------------------------
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /**
   * Tests whether line segment O->P strictly intersects wall segment A->B.
   * Endpoint tolerance on `u` prevents diagonal light leaks between corners.
   */
  function segmentsIntersect(ox, oy, px, py, ax, ay, bx, by) {
    const rdx = px - ox;
    const rdy = py - oy;
    const sdx = bx - ax;
    const sdy = by - ay;

    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-9) return false;

    const qpx = ax - ox;
    const qpy = ay - oy;
    const t = (qpx * sdy - qpy * sdx) / denom;
    const u = (qpx * rdy - qpy * rdx) / denom;

    return t > 1e-5 && t < 1 - 1e-5 && u >= -1e-5 && u <= 1 + 1e-5;
  }

  /**
   * Parametric ray-segment intersection from origin (ox, oy) along unit (dx, dy).
   * Returns distance `t` along ray if hit, or Infinity otherwise.
   */
  function raySegmentDistance(ox, oy, dx, dy, ax, ay, bx, by) {
    const sdx = bx - ax;
    const sdy = by - ay;
    const denom = dx * sdy - dy * sdx;
    if (Math.abs(denom) < 1e-9) return Infinity;

    const qpx = ax - ox;
    const qpy = ay - oy;
    const t = (qpx * sdy - qpy * sdx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;

    if (t > 0 && u >= -1e-7 && u <= 1 + 1e-7) {
      return t;
    }
    return Infinity;
  }

  // --------------------------------------------------------------------------
  // Main Game Engine Class
  // --------------------------------------------------------------------------
  class ShadowLightGame {
    constructor() {
      this.canvas = document.getElementById("game-canvas");
      this.ctx = this.canvas.getContext("2d");

      // Offscreen buffer for compositing dynamic raycast darkness & light falloff
      this.lightCanvas = document.createElement("canvas");
      this.lightCanvas.width = LOGICAL_WIDTH;
      this.lightCanvas.height = LOGICAL_HEIGHT;
      this.lightCtx = this.lightCanvas.getContext("2d");

      // HUD DOM references
      this.ui = {
        levelDisplay: document.getElementById("level-display"),
        levelName: document.getElementById("level-name"),
        orbPill: document.getElementById("orb-pill"),
        orbStatus: document.getElementById("orb-status"),
        tutorialBanner: document.getElementById("tutorial-banner"),
        tutorialText: document.getElementById("tutorial-text"),
        victoryScreen: document.getElementById("victory-screen"),
        statTime: document.getElementById("stat-time"),
        statAnchors: document.getElementById("stat-anchors"),
        statDeaths: document.getElementById("stat-deaths"),
        playAgainBtn: document.getElementById("play-again-btn")
      };

      // Input state
      this.keys = new Set();

      // Run statistics
      this.stats = {
        elapsedSeconds: 0,
        anchors: 0,
        deaths: 0
      };

      // Level & Entity containers
      this.levelIndex = 0;
      this.state = "playing"; // 'playing' | 'dying' | 'transition' | 'victory'
      this.stateTimer = 0;
      this.fadeAlpha = 1;
      this.fadeDirection = -1; // -1 = fading in, +1 = fading out
      this.shakeTime = 0;
      this.shakeIntensity = 0;
      this.time = 0;

      this.grid = [];
      this.wallSegments = [];
      this.rayVertices = [];
      this.bridges = [];
      this.traps = [];
      this.runes = [];
      this.portal = { x: 0, y: 0 };
      this.lightRadius = 280;

      this.player = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        facingX: 1,
        facingY: 0,
        alive: true,
        trailTimer: 0
      };

      this.orb = {
        x: 0,
        y: 0,
        anchored: false,
        pulse: 0,
        recallComet: null // Visual streak when recalling orb
      };

      this.visibilityPoly = [];
      this.particles = [];
      this.dustMotes = [];
      this.ripples = [];

      this.setupHighDPI();
      this.bindEvents();
      this.initDustMotes();
      this.loadLevel(0);

      this.lastFrameTime = performance.now();
      requestAnimationFrame((ts) => this.loop(ts));
    }

    // ------------------------------------------------------------------------
    // Display & Event Setup
    // ------------------------------------------------------------------------
    setupHighDPI() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.canvas.width = LOGICAL_WIDTH * dpr;
      this.canvas.height = LOGICAL_HEIGHT * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    bindEvents() {
      window.addEventListener("resize", () => this.setupHighDPI());

      window.addEventListener("keydown", (e) => {
        const code = e.code;
        if (
          code === "ArrowUp" ||
          code === "ArrowDown" ||
          code === "ArrowLeft" ||
          code === "ArrowRight" ||
          code === "Space"
        ) {
          e.preventDefault();
        }

        if (this.state === "victory") {
          if (!e.repeat && (code === "Enter" || code === "Space")) {
            this.restartFullGame();
          }
          return;
        }

        this.keys.add(code);

        if (!e.repeat) {
          if (code === "Space" && this.state === "playing") {
            this.toggleLightOrb();
          } else if (code === "KeyR" && (this.state === "playing" || this.state === "dying")) {
            this.quickRestartLevel();
          }
        }
      });

      window.addEventListener("keyup", (e) => {
        this.keys.delete(e.code);
      });

      window.addEventListener("blur", () => {
        this.keys.clear();
      });

      this.ui.playAgainBtn.addEventListener("click", () => {
        this.restartFullGame();
      });
    }

    initDustMotes() {
      this.dustMotes = [];
      for (let i = 0; i < 52; i++) {
        this.dustMotes.push({
          x: Math.random() * LOGICAL_WIDTH,
          y: Math.random() * LOGICAL_HEIGHT,
          vx: (Math.random() - 0.5) * 14,
          vy: -4 - Math.random() * 10,
          size: 1 + Math.random() * 1.8,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    // ------------------------------------------------------------------------
    // Level Loader & Merged Wall Segment Builder
    // ------------------------------------------------------------------------
    loadLevel(index) {
      this.levelIndex = index;
      const def = LEVELS[index];
      this.lightRadius = def.lightRadius;

      this.grid = def.grid.map((row) => row.split(""));
      this.bridges = [];
      this.traps = [];
      this.runes = [];
      this.particles = [];
      this.ripples = [];

      let spawnX = TILE * 2.5;
      let spawnY = TILE * 2.5;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.grid[r][c];
          const cx = c * TILE + TILE * 0.5;
          const cy = r * TILE + TILE * 0.5;

          if (ch === "S") {
            spawnX = cx;
            spawnY = cy;
          } else if (ch === "E") {
            this.portal = { x: cx, y: cy, c, r };
          } else if (ch === "=") {
            this.bridges.push({ c, r, cx, cy, lit: false, litAnim: 0 });
          } else if (ch === "^") {
            this.traps.push({ c, r, cx, cy, active: false, activeAnim: 0 });
          } else if (ch === "*") {
            this.runes.push({ c, r, cx, cy });
          }
        }
      }

      this.player.x = spawnX;
      this.player.y = spawnY;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.facingX = 1;
      this.player.facingY = 0;
      this.player.alive = true;

      this.orb.x = spawnX;
      this.orb.y = spawnY;
      this.orb.anchored = false;
      this.orb.recallComet = null;

      this.buildWallGeometry();
      this.updateLightingAndMechanics(0, true);

      this.state = "playing";
      this.stateTimer = 0;
      this.fadeAlpha = 1;
      this.fadeDirection = -1;

      this.syncHUD();
    }

    /**
     * Extracts exposed `#` wall edges and merges collinear contiguous edges into
     * minimal line segments for crisp, seam-free 2D shadow casting.
     */
    buildWallGeometry() {
      const isWall = (c, r) => {
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
        return this.grid[r][c] === "#";
      };

      const segments = [];

      // Merge horizontal top & bottom exposed wall edges
      for (let r = 0; r < ROWS; r++) {
        // Top edges of wall cells where (r - 1) is NOT a wall
        let startC = -1;
        for (let c = 0; c <= COLS; c++) {
          const exposed = c < COLS && isWall(c, r) && !isWall(c, r - 1);
          if (exposed && startC === -1) {
            startC = c;
          } else if (!exposed && startC !== -1) {
            segments.push({
              x1: startC * TILE,
              y1: r * TILE,
              x2: c * TILE,
              y2: r * TILE,
              nx: 0,
              ny: -1
            });
            startC = -1;
          }
        }

        // Bottom edges of wall cells where (r + 1) is NOT a wall
        startC = -1;
        for (let c = 0; c <= COLS; c++) {
          const exposed = c < COLS && isWall(c, r) && !isWall(c, r + 1);
          if (exposed && startC === -1) {
            startC = c;
          } else if (!exposed && startC !== -1) {
            segments.push({
              x1: startC * TILE,
              y1: (r + 1) * TILE,
              x2: c * TILE,
              y2: (r + 1) * TILE,
              nx: 0,
              ny: 1
            });
            startC = -1;
          }
        }
      }

      // Merge vertical left & right exposed wall edges
      for (let c = 0; c < COLS; c++) {
        // Left edges where (c - 1) is NOT a wall
        let startR = -1;
        for (let r = 0; r <= ROWS; r++) {
          const exposed = r < ROWS && isWall(c, r) && !isWall(c - 1, r);
          if (exposed && startR === -1) {
            startR = r;
          } else if (!exposed && startR !== -1) {
            segments.push({
              x1: c * TILE,
              y1: startR * TILE,
              x2: c * TILE,
              y2: r * TILE,
              nx: -1,
              ny: 0
            });
            startR = -1;
          }
        }

        // Right edges where (c + 1) is NOT a wall
        startR = -1;
        for (let r = 0; r <= ROWS; r++) {
          const exposed = r < ROWS && isWall(c, r) && !isWall(c + 1, r);
          if (exposed && startR === -1) {
            startR = r;
          } else if (!exposed && startR !== -1) {
            segments.push({
              x1: (c + 1) * TILE,
              y1: startR * TILE,
              x2: (c + 1) * TILE,
              y2: r * TILE,
              nx: 1,
              ny: 0
            });
            startR = -1;
          }
        }
      }

      // Ensure outer room boundary encloses all rays
      segments.push(
        { x1: 0, y1: 0, x2: LOGICAL_WIDTH, y2: 0, nx: 0, ny: 1 },
        { x1: LOGICAL_WIDTH, y1: 0, x2: LOGICAL_WIDTH, y2: LOGICAL_HEIGHT, nx: -1, ny: 0 },
        { x1: LOGICAL_WIDTH, y1: LOGICAL_HEIGHT, x2: 0, y2: LOGICAL_HEIGHT, nx: 0, ny: -1 },
        { x1: 0, y1: LOGICAL_HEIGHT, x2: 0, y2: 0, nx: 1, ny: 0 }
      );

      this.wallSegments = segments;

      // Deduplicate segment endpoints for visibility raycasting targets
      const vertexMap = new Map();
      for (const seg of segments) {
        vertexMap.set(`${seg.x1},${seg.y1}`, { x: seg.x1, y: seg.y1 });
        vertexMap.set(`${seg.x2},${seg.y2}`, { x: seg.x2, y: seg.y2 });
      }
      this.rayVertices = Array.from(vertexMap.values());
    }

    // ------------------------------------------------------------------------
    // HUD & Game Flow Helpers
    // ------------------------------------------------------------------------
    syncHUD() {
      const def = LEVELS[this.levelIndex];
      this.ui.levelDisplay.textContent = `Level ${this.levelIndex + 1}/${LEVELS.length}`;
      this.ui.levelName.textContent = def.name;

      if (this.orb.anchored) {
        this.ui.orbStatus.textContent = "Anchored";
        this.ui.orbPill.classList.remove("orb-carried");
        this.ui.orbPill.classList.add("orb-anchored");
      } else {
        this.ui.orbStatus.textContent = "Carried";
        this.ui.orbPill.classList.remove("orb-anchored");
        this.ui.orbPill.classList.add("orb-carried");
      }

      // Tutorial hint banner for the first 3 levels
      if (def.hint) {
        this.ui.tutorialText.textContent = def.hint;
        this.ui.tutorialBanner.classList.remove("hidden");
      } else {
        this.ui.tutorialBanner.classList.add("hidden");
      }
    }

    toggleLightOrb() {
      if (!this.orb.anchored) {
        // Drop / Anchor Light Orb at the player's current position
        this.orb.anchored = true;
        this.orb.x = this.player.x;
        this.orb.y = this.player.y;
        this.orb.recallComet = null;
        this.stats.anchors++;

        this.ripples.push({
          x: this.orb.x,
          y: this.orb.y,
          radius: 8,
          maxRadius: 68,
          color: "56, 226, 255",
          alpha: 0.85
        });
        this.spawnBurst(this.orb.x, this.orb.y, 14, "#38e2ff", "#ffd166", 35, 110);
      } else {
        // Recall Light Orb back to the player
        const prevX = this.orb.x;
        const prevY = this.orb.y;
        this.orb.anchored = false;
        this.orb.x = this.player.x;
        this.orb.y = this.player.y;
        this.orb.recallComet = {
          fromX: prevX,
          fromY: prevY,
          progress: 0
        };

        this.ripples.push({
          x: prevX,
          y: prevY,
          radius: 18,
          maxRadius: 48,
          color: "255, 209, 102",
          alpha: 0.65
        });
        this.ripples.push({
          x: this.player.x,
          y: this.player.y,
          radius: 6,
          maxRadius: 54,
          color: "255, 209, 102",
          alpha: 0.85
        });
        this.spawnBurst(this.player.x, this.player.y, 14, "#ffd166", "#fff3b0", 30, 105);
      }

      this.syncHUD();
    }

    quickRestartLevel() {
      this.spawnBurst(this.player.x, this.player.y, 18, "#7ce8ff", "#ffffff", 40, 130);
      this.loadLevel(this.levelIndex);
    }

    restartFullGame() {
      this.stats.elapsedSeconds = 0;
      this.stats.anchors = 0;
      this.stats.deaths = 0;
      this.ui.victoryScreen.classList.add("hidden");
      this.loadLevel(0);
    }

    showVictoryScreen() {
      this.state = "victory";
      const totalSec = Math.floor(this.stats.elapsedSeconds);
      const mins = Math.floor(totalSec / 60);
      const secs = String(totalSec % 60).padStart(2, "0");

      this.ui.statTime.textContent = `${mins}:${secs}`;
      this.ui.statAnchors.textContent = String(this.stats.anchors);
      this.ui.statDeaths.textContent = String(this.stats.deaths);
      this.ui.victoryScreen.classList.remove("hidden");
    }

    // ------------------------------------------------------------------------
    // Deterministic 2D Visibility & Raycasting Specifications
    // ------------------------------------------------------------------------

    /**
     * Fast, deterministic check returning whether world point (x, y) is illuminated
     * by the Light Orb (within lightRadius AND unobstructed by solid walls).
     */
    isPointLit(x, y) {
      const ox = this.orb.x;
      const oy = this.orb.y;
      const dx = x - ox;
      const dy = y - oy;
      const distSq = dx * dx + dy * dy;

      if (distSq > this.lightRadius * this.lightRadius) return false;
      if (distSq < 1e-6) return true;

      const segs = this.wallSegments;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (segmentsIntersect(ox, oy, x, y, s.x1, s.y1, s.x2, s.y2)) {
          return false;
        }
      }
      return true;
    }

    /**
     * Computes the exact 2D visibility polygon from light origin (ox, oy)
     * by casting triplet rays (-eps, 0, +eps) toward every wall endpoint.
     */
    computeVisibilityPolygon(ox, oy) {
      const angles = [];
      const verts = this.rayVertices;

      for (let i = 0; i < verts.length; i++) {
        const base = Math.atan2(verts[i].y - oy, verts[i].x - ox);
        angles.push(base - RAY_EPSILON, base, base + RAY_EPSILON);
      }

      const segs = this.wallSegments;
      const hits = [];

      for (let i = 0; i < angles.length; i++) {
        const angle = angles[i];
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        let minT = Infinity;
        for (let j = 0; j < segs.length; j++) {
          const s = segs[j];
          const t = raySegmentDistance(ox, oy, dx, dy, s.x1, s.y1, s.x2, s.y2);
          if (t < minT) {
            minT = t;
          }
        }

        if (minT < Infinity) {
          hits.push({
            angle,
            x: ox + dx * minT,
            y: oy + dy * minT
          });
        }
      }

      hits.sort((a, b) => a.angle - b.angle);

      // Filter near-identical consecutive vertices for clean Canvas pathing
      const poly = [];
      for (let i = 0; i < hits.length; i++) {
        const p = hits[i];
        const prev = poly[poly.length - 1];
        if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.25) {
          poly.push(p);
        }
      }
      return poly;
    }

    // ------------------------------------------------------------------------
    // Physics, Collision & Puzzle Mechanics Update
    // ------------------------------------------------------------------------
    isTileBlockingMovement(c, r) {
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
      const ch = this.grid[r][c];
      if (ch === "#" || ch === "~") return true;
      if (ch === "=") {
        // Shadow Bridge is walkable ONLY when illuminated by the Light Orb
        for (let i = 0; i < this.bridges.length; i++) {
          const b = this.bridges[i];
          if (b.c === c && b.r === r) return !b.lit;
        }
      }
      return false;
    }

    moveAndCollidePlayer(dt) {
      let ix = 0;
      let iy = 0;
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) iy -= 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) iy += 1;
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) ix -= 1;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) ix += 1;

      if (ix !== 0 || iy !== 0) {
        const len = Math.hypot(ix, iy);
        ix /= len;
        iy /= len;
        this.player.vx += ix * PLAYER_ACCEL * dt;
        this.player.vy += iy * PLAYER_ACCEL * dt;
        this.player.facingX = lerp(this.player.facingX, ix, clamp(dt * 12, 0, 1));
        this.player.facingY = lerp(this.player.facingY, iy, clamp(dt * 12, 0, 1));
      } else {
        const damp = Math.exp(-PLAYER_FRICTION * dt);
        this.player.vx *= damp;
        this.player.vy *= damp;
      }

      const speed = Math.hypot(this.player.vx, this.player.vy);
      if (speed > PLAYER_MAX_SPEED) {
        const scale = PLAYER_MAX_SPEED / speed;
        this.player.vx *= scale;
        this.player.vy *= scale;
      }

      this.player.x += this.player.vx * dt;
      this.player.y += this.player.vy * dt;

      // Resolve circle-vs-tile AABB collisions (sorted nearest-first to prevent seam snags)
      const pc = Math.floor(this.player.x / TILE);
      const pr = Math.floor(this.player.y / TILE);
      const candidates = [];

      for (let r = pr - 1; r <= pr + 1; r++) {
        for (let c = pc - 1; c <= pc + 1; c++) {
          if (this.isTileBlockingMovement(c, r)) {
            const cx = c * TILE + TILE * 0.5;
            const cy = r * TILE + TILE * 0.5;
            const dSq = (this.player.x - cx) ** 2 + (this.player.y - cy) ** 2;
            candidates.push({ c, r, dSq });
          }
        }
      }

      candidates.sort((a, b) => a.dSq - b.dSq);

      for (let i = 0; i < candidates.length; i++) {
        const { c, r } = candidates[i];
        const minX = c * TILE;
        const maxX = minX + TILE;
        const minY = r * TILE;
        const maxY = minY + TILE;

        const closestX = clamp(this.player.x, minX, maxX);
        const closestY = clamp(this.player.y, minY, maxY);
        const dx = this.player.x - closestX;
        const dy = this.player.y - closestY;
        const distSq = dx * dx + dy * dy;

        if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-6) {
            const overlap = PLAYER_RADIUS - dist;
            const nx = dx / dist;
            const ny = dy / dist;
            this.player.x += nx * overlap;
            this.player.y += ny * overlap;

            const vn = this.player.vx * nx + this.player.vy * ny;
            if (vn < 0) {
              this.player.vx -= vn * nx;
              this.player.vy -= vn * ny;
            }
          } else {
            this.player.y -= PLAYER_RADIUS;
          }
        }
      }

      // Subtle spirit trail particles when gliding
      if (speed > 45) {
        this.player.trailTimer -= dt;
        if (this.player.trailTimer <= 0) {
          this.player.trailTimer = 0.045;
          this.particles.push({
            x: this.player.x + (Math.random() - 0.5) * 8,
            y: this.player.y + (Math.random() - 0.5) * 8,
            vx: -this.player.vx * 0.12 + (Math.random() - 0.5) * 12,
            vy: -this.player.vy * 0.12 + (Math.random() - 0.5) * 12,
            life: 0.35 + Math.random() * 0.2,
            maxLife: 0.55,
            size: 2 + Math.random() * 2,
            color: this.orb.anchored ? "#8ef3ff" : "#ffe699"
          });
        }
      }
    }

    updateLightingAndMechanics(dt, instant = false) {
      if (!this.orb.anchored) {
        this.orb.x = this.player.x;
        this.orb.y = this.player.y;
      }

      if (this.orb.recallComet) {
        this.orb.recallComet.progress += dt * 5.8;
        if (this.orb.recallComet.progress >= 1) {
          this.orb.recallComet = null;
        }
      }

      // Compute 2D Visibility Polygon from Light Orb
      this.visibilityPoly = this.computeVisibilityPolygon(this.orb.x, this.orb.y);

      // Update Shadow Bridges (Cyan)
      for (let i = 0; i < this.bridges.length; i++) {
        const b = this.bridges[i];
        const wasLit = b.lit;
        b.lit = this.isPointLit(b.cx, b.cy);

        if (instant) {
          b.litAnim = b.lit ? 1 : 0;
        } else {
          const target = b.lit ? 1 : 0;
          b.litAnim = lerp(b.litAnim, target, clamp(dt * 11, 0, 1));
          if (!wasLit && b.lit) {
            this.spawnBurst(b.cx, b.cy, 4, "#38e2ff", "#b8f7ff", 15, 55);
          }
        }
      }

      // Update Light-Sensitive Sentries / Traps (Crimson)
      for (let i = 0; i < this.traps.length; i++) {
        const t = this.traps[i];
        t.active = this.isPointLit(t.cx, t.cy);
        if (instant) {
          t.activeAnim = t.active ? 1 : 0;
        } else {
          const target = t.active ? 1 : 0;
          t.activeAnim = lerp(t.activeAnim, target, clamp(dt * 14, 0, 1));
        }
      }

      if (this.state !== "playing") return;

      // Check lethal collision with illuminated Crimson Sentries
      const killDist = PLAYER_RADIUS + TRAP_LETHAL_RADIUS;
      const killDistSq = killDist * killDist;
      for (let i = 0; i < this.traps.length; i++) {
        const t = this.traps[i];
        if (t.active) {
          const dx = this.player.x - t.cx;
          const dy = this.player.y - t.cy;
          if (dx * dx + dy * dy < killDistSq) {
            this.triggerPlayerDeath("trap");
            return;
          }
        }
      }

      // Safety check if player center ever stands over an unlit chasm/bridge
      const curC = Math.floor(this.player.x / TILE);
      const curR = Math.floor(this.player.y / TILE);
      if (this.isTileBlockingMovement(curC, curR) && this.grid[curR]?.[curC] !== "#") {
        this.triggerPlayerDeath("void");
        return;
      }

      // Check Gold Exit Portal completion
      const pdx = this.player.x - this.portal.x;
      const pdy = this.player.y - this.portal.y;
      if (pdx * pdx + pdy * pdy <= (PLAYER_RADIUS + PORTAL_RADIUS) ** 2) {
        this.triggerLevelComplete();
      }
    }

    triggerPlayerDeath(cause) {
      this.state = "dying";
      this.stateTimer = 0.68;
      this.player.alive = false;
      this.stats.deaths++;
      this.shakeTime = 0.28;
      this.shakeIntensity = 6;

      if (cause === "trap") {
        this.spawnBurst(this.player.x, this.player.y, 34, "#ff2e63", "#ffd166", 45, 210);
        this.ripples.push({
          x: this.player.x,
          y: this.player.y,
          radius: 6,
          maxRadius: 82,
          color: "255, 46, 99",
          alpha: 0.95
        });
      } else {
        this.spawnBurst(this.player.x, this.player.y, 28, "#38e2ff", "#eef3ff", 30, 150);
      }
    }

    triggerLevelComplete() {
      this.state = "transition";
      this.stateTimer = 0.72;
      this.fadeDirection = 1;

      this.ripples.push({
        x: this.portal.x,
        y: this.portal.y,
        radius: 10,
        maxRadius: 120,
        color: "255, 209, 102",
        alpha: 1
      });
      this.spawnBurst(this.portal.x, this.portal.y, 40, "#ffd166", "#ffffff", 50, 220);
    }

    spawnBurst(x, y, count, colorA, colorB, minSpeed, maxSpeed) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
        const life = 0.35 + Math.random() * 0.45;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life,
          maxLife: life,
          size: 2 + Math.random() * 3.2,
          color: i % 2 === 0 ? colorA : colorB
        });
      }
    }

    // ------------------------------------------------------------------------
    // Main Loop (60+ FPS Delta-Time)
    // ------------------------------------------------------------------------
    loop(timestamp) {
      const rawDt = (timestamp - this.lastFrameTime) / 1000;
      this.lastFrameTime = timestamp;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      this.update(dt);
      this.render();

      requestAnimationFrame((ts) => this.loop(ts));
    }

    update(dt) {
      this.time += dt;
      this.orb.pulse += dt * 3.2;

      if (this.state === "playing") {
        this.stats.elapsedSeconds += dt;
        this.moveAndCollidePlayer(dt);
        this.updateLightingAndMechanics(dt);
      } else if (this.state === "dying") {
        this.stateTimer -= dt;
        if (this.stateTimer > 0 && this.stateTimer < 0.35) {
          this.fadeDirection = 1;
        }
        if (this.stateTimer <= 0) {
          this.loadLevel(this.levelIndex);
        }
      } else if (this.state === "transition") {
        // Gently pull player spirit into the center of the Gold Portal
        this.player.x = lerp(this.player.x, this.portal.x, clamp(dt * 8, 0, 1));
        this.player.y = lerp(this.player.y, this.portal.y, clamp(dt * 8, 0, 1));
        this.updateLightingAndMechanics(dt);

        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          if (this.levelIndex + 1 < LEVELS.length) {
            this.loadLevel(this.levelIndex + 1);
          } else {
            this.fadeDirection = -1;
            this.showVictoryScreen();
          }
        }
      }

      // Smooth screen fade
      if (this.fadeDirection === -1 && this.fadeAlpha > 0) {
        this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 3.2);
      } else if (this.fadeDirection === 1 && this.fadeAlpha < 1) {
        this.fadeAlpha = Math.min(1, this.fadeAlpha + dt * 3.4);
      }

      if (this.shakeTime > 0) {
        this.shakeTime = Math.max(0, this.shakeTime - dt);
      }

      // Update ambient floating dust motes
      for (let i = 0; i < this.dustMotes.length; i++) {
        const m = this.dustMotes[i];
        m.x += m.vx * dt + Math.sin(this.time * 1.3 + m.phase) * 4 * dt;
        m.y += m.vy * dt;
        if (m.x < 0) m.x += LOGICAL_WIDTH;
        if (m.x > LOGICAL_WIDTH) m.x -= LOGICAL_WIDTH;
        if (m.y < 0) m.y += LOGICAL_HEIGHT;
        if (m.y > LOGICAL_HEIGHT) m.y -= LOGICAL_HEIGHT;
      }

      // Update active particle bursts
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-3.5 * dt);
        p.vy *= Math.exp(-3.5 * dt);
      }

      // Update expanding light ripples
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.radius = lerp(r.radius, r.maxRadius, clamp(dt * 8, 0, 1));
        r.alpha -= dt * 1.9;
        if (r.alpha <= 0) {
          this.ripples.splice(i, 1);
        }
      }
    }

    // ------------------------------------------------------------------------
    // Multi-Layer Atmospheric & Dynamic Shadow Renderer
    // ------------------------------------------------------------------------
    render() {
      const ctx = this.ctx;
      ctx.save();

      // Subtle camera micro-shake on death
      if (this.shakeTime > 0) {
        const mag = (this.shakeTime / 0.28) * this.shakeIntensity;
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
      }

      // 1. Base Abyss & Stone Floor Architecture
      this.renderFloorAndAbyss(ctx);

      // 2. Interactive Elements (Base Layer before shadow veil)
      this.renderShadowBridges(ctx, false);
      this.renderCrimsonTraps(ctx, false);
      this.renderExitPortal(ctx, false);

      // 3. Dynamic 2D Raycast Lighting, Shadows & Dust Motes
      this.renderDynamicLighting(ctx);

      // 4. Solid Obsidian Walls & Orb-Facing Rim Highlights
      this.renderWalls(ctx);

      // 5. Additive Neon Glows for Lit Bridges, Active Sentries & Portal
      this.renderShadowBridges(ctx, true);
      this.renderCrimsonTraps(ctx, true);
      this.renderExitPortal(ctx, true);

      // 6. Orb Anchor Tether, Ripples, Player Spirit, Light Orb & Particles
      this.renderRipples(ctx);
      this.renderOrbAndSpirit(ctx);
      this.renderParticles(ctx);

      // 7. Smooth Chamber Fade Overlay
      if (this.fadeAlpha > 0.005) {
        ctx.fillStyle = `rgba(11, 13, 19, ${this.fadeAlpha})`;
        ctx.fillRect(-16, -16, LOGICAL_WIDTH + 32, LOGICAL_HEIGHT + 32);
      }

      ctx.restore();
    }

    renderFloorAndAbyss(ctx) {
      // Deep void base
      ctx.fillStyle = "#06080d";
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const ch = this.grid[r][c];
          const x = c * TILE;
          const y = r * TILE;

          if (ch === "~" || ch === "=") {
            // Recessed cliff lip if tile directly above is walkable stone floor
            const above = r > 0 ? this.grid[r - 1][c] : "#";
            if (above !== "~" && above !== "=" && above !== "#") {
              const cliffGrad = ctx.createLinearGradient(x, y, x, y + 12);
              cliffGrad.addColorStop(0, "#151b2b");
              cliffGrad.addColorStop(1, "rgba(6, 8, 13, 0)");
              ctx.fillStyle = cliffGrad;
              ctx.fillRect(x, y, TILE, 12);
            }
            continue;
          }

          if (ch !== "#") {
            // Walkable stone chamber tile
            const checker = (c + r) % 2 === 0;
            ctx.fillStyle = checker ? "#141927" : "#121724";
            ctx.fillRect(x, y, TILE, TILE);

            ctx.strokeStyle = "rgba(120, 150, 210, 0.06)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          }
        }
      }

      // Optional floor anchor hint runes (`*`)
      for (let i = 0; i < this.runes.length; i++) {
        const rune = this.runes[i];
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.6 + i);
        ctx.save();
        ctx.translate(rune.cx, rune.cy);
        ctx.strokeStyle = `rgba(56, 226, 255, ${0.22 + pulse * 0.18})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.stroke();

        ctx.rotate(this.time * 0.45);
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.2 + pulse * 0.16})`;
        ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
      }
    }

    renderShadowBridges(ctx, glowPass) {
      for (let i = 0; i < this.bridges.length; i++) {
        const b = this.bridges[i];
        const x = b.c * TILE;
        const y = b.r * TILE;
        const a = b.litAnim;

        if (!glowPass) {
          // Dormant / Faded wireframe in shadow vs solidified cyan crystal in light
          ctx.save();
          if (a < 0.05) {
            ctx.strokeStyle = "rgba(56, 226, 255, 0.18)";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
            ctx.setLineDash([]);

            // Unpowered receptor diamond at (cx, cy)
            ctx.fillStyle = "rgba(56, 226, 255, 0.22)";
            ctx.beginPath();
            ctx.moveTo(b.cx, b.cy - 4);
            ctx.lineTo(b.cx + 4, b.cy);
            ctx.lineTo(b.cx, b.cy + 4);
            ctx.lineTo(b.cx - 4, b.cy);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillStyle = `rgba(22, 118, 152, ${0.22 + a * 0.42})`;
            ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);

            ctx.strokeStyle = `rgba(92, 236, 255, ${0.25 + a * 0.65})`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
          }
          ctx.restore();
        } else if (a > 0.04) {
          // Luminous post-shadow neon lattice pass
          const shimmer = 0.85 + 0.15 * Math.sin(this.time * 4.2 + b.c * 0.7 + b.r * 0.5);
          const alpha = a * shimmer;

          ctx.save();
          ctx.globalCompositeOperation = "lighter";

          const grad = ctx.createRadialGradient(b.cx, b.cy, 2, b.cx, b.cy, TILE * 0.68);
          grad.addColorStop(0, `rgba(160, 250, 255, ${0.42 * alpha})`);
          grad.addColorStop(0.6, `rgba(56, 226, 255, ${0.2 * alpha})`);
          grad.addColorStop(1, "rgba(56, 226, 255, 0)");
          ctx.fillStyle = grad;
          ctx.fillRect(x - 4, y - 4, TILE + 8, TILE + 8);

          // Inner crystalline struts
          ctx.strokeStyle = `rgba(142, 243, 255, ${0.55 * alpha})`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(x + 6, y + 6);
          ctx.lineTo(x + TILE - 6, y + TILE - 6);
          ctx.moveTo(x + TILE - 6, y + 6);
          ctx.lineTo(x + 6, y + TILE - 6);
          ctx.stroke();

          // Central receptor crystal
          ctx.fillStyle = `rgba(230, 255, 255, ${0.9 * alpha})`;
          ctx.beginPath();
          ctx.moveTo(b.cx, b.cy - 5);
          ctx.lineTo(b.cx + 5, b.cy);
          ctx.lineTo(b.cx, b.cy + 5);
          ctx.lineTo(b.cx - 5, b.cy);
          ctx.closePath();
          ctx.fill();

          ctx.restore();
        }
      }
    }

    renderCrimsonTraps(ctx, glowPass) {
      for (let i = 0; i < this.traps.length; i++) {
        const t = this.traps[i];
        const a = t.activeAnim;

        if (!glowPass) {
          // Metallic sentry socket on floor (safe & retracted when in shadow)
          ctx.save();
          ctx.translate(t.cx, t.cy);

          ctx.fillStyle = "#181421";
          ctx.beginPath();
          ctx.arc(0, 0, 13, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = a > 0.2 ? "rgba(255, 46, 99, 0.7)" : "rgba(180, 65, 95, 0.36)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, 12.5, 0, Math.PI * 2);
          ctx.stroke();

          // Dormant core eye
          ctx.fillStyle = "rgba(190, 45, 82, 0.38)";
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        } else if (a > 0.03) {
          // Active lethal crimson spikes & laser aura when hit by light
          const pulse = 0.85 + 0.15 * Math.sin(this.time * 11 + i);
          ctx.save();
          ctx.translate(t.cx, t.cy);

          // Crimson radial warning bloom
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
          glow.addColorStop(0, `rgba(255, 90, 130, ${0.7 * a * pulse})`);
          glow.addColorStop(0.55, `rgba(255, 46, 99, ${0.34 * a * pulse})`);
          glow.addColorStop(1, "rgba(255, 46, 99, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(0, 0, 24, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Extending 4-way crimson blades
          ctx.rotate(this.time * 1.8 * a + Math.PI * 0.25);
          const spikeLen = 6 + 10 * a * pulse;
          ctx.fillStyle = `rgba(255, 56, 104, ${0.95 * a})`;
          for (let k = 0; k < 4; k++) {
            ctx.rotate(Math.PI * 0.5);
            ctx.beginPath();
            ctx.moveTo(0, -spikeLen);
            ctx.lineTo(3.8, -5);
            ctx.lineTo(-3.8, -5);
            ctx.closePath();
            ctx.fill();
          }

          // Blazing photonic eye
          ctx.fillStyle = `rgba(255, 225, 235, ${a})`;
          ctx.beginPath();
          ctx.arc(0, 0, 4.2 * a, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        }
      }
    }

    renderExitPortal(ctx, glowPass) {
      const { x, y } = this.portal;
      if (!glowPass) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = "#1d1a14";
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 209, 102, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
        return;
      }

      // Luminous golden vortex & rotating astrolabe rings
      const pulse = 0.9 + 0.1 * Math.sin(this.time * 3.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = "lighter";

      const halo = ctx.createRadialGradient(0, 0, 3, 0, 0, 36 * pulse);
      halo.addColorStop(0, "rgba(255, 248, 210, 0.95)");
      halo.addColorStop(0.38, "rgba(255, 209, 102, 0.52)");
      halo.addColorStop(0.75, "rgba(255, 170, 0, 0.16)");
      halo.addColorStop(1, "rgba(255, 170, 0, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 36 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Outer rotating ring
      ctx.save();
      ctx.rotate(this.time * 1.1);
      ctx.strokeStyle = "rgba(255, 214, 112, 0.8)";
      ctx.lineWidth = 1.8;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Inner counter-rotating square sigil
      ctx.save();
      ctx.rotate(-this.time * 1.7);
      ctx.strokeStyle = "rgba(255, 244, 196, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-7.5, -7.5, 15, 15);
      ctx.restore();

      ctx.restore();
    }

    /**
     * Renders crisp 2D raycast shadows on the offscreen mask, plus warm
     * additive radial illumination and floating dust particles in lit regions.
     */
    renderDynamicLighting(ctx) {
      const lctx = this.lightCtx;
      const poly = this.visibilityPoly;
      const ox = this.orb.x;
      const oy = this.orb.y;
      const radius = this.lightRadius;

      // 1. Fill offscreen darkness veil
      lctx.save();
      lctx.globalCompositeOperation = "source-over";
      lctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      lctx.fillStyle = "rgba(6, 8, 14, 0.84)";
      lctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

      // 2. Carve out dynamic 2D visibility polygon from the Light Orb
      if (poly.length >= 3) {
        lctx.save();
        lctx.globalCompositeOperation = "destination-out";

        lctx.beginPath();
        lctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          lctx.lineTo(poly[i].x, poly[i].y);
        }
        lctx.closePath();
        lctx.clip();

        const cutGrad = lctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
        cutGrad.addColorStop(0, "rgba(0, 0, 0, 1)");
        cutGrad.addColorStop(0.68, "rgba(0, 0, 0, 0.94)");
        cutGrad.addColorStop(0.95, "rgba(0, 0, 0, 0.62)");
        cutGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

        lctx.fillStyle = cutGrad;
        lctx.beginPath();
        lctx.arc(ox, oy, radius, 0, Math.PI * 2);
        lctx.fill();
        lctx.restore();
      }

      // Subtle purely-visual self-spirit visibility aura so player is always readable in shadow
      if (this.player.alive && this.orb.anchored) {
        lctx.save();
        lctx.globalCompositeOperation = "destination-out";
        const spiritHalo = lctx.createRadialGradient(
          this.player.x,
          this.player.y,
          0,
          this.player.x,
          this.player.y,
          36
        );
        spiritHalo.addColorStop(0, "rgba(0, 0, 0, 0.48)");
        spiritHalo.addColorStop(1, "rgba(0, 0, 0, 0)");
        lctx.fillStyle = spiritHalo;
        lctx.beginPath();
        lctx.arc(this.player.x, this.player.y, 36, 0, Math.PI * 2);
        lctx.fill();
        lctx.restore();
      }

      lctx.restore();

      // Composite shadow mask onto main canvas
      ctx.drawImage(this.lightCanvas, 0, 0);

      // 3. Warm radial light cone & floating dust motes clipped to visibility polygon
      if (poly.length >= 3) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.clip();

        ctx.globalCompositeOperation = "lighter";
        const breath = 1 + 0.015 * Math.sin(this.orb.pulse);
        const warmGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius * breath);
        warmGrad.addColorStop(0, "rgba(255, 236, 178, 0.23)");
        warmGrad.addColorStop(0.45, "rgba(255, 200, 112, 0.09)");
        warmGrad.addColorStop(0.92, "rgba(72, 195, 255, 0.03)");
        warmGrad.addColorStop(1, "rgba(56, 226, 255, 0)");

        ctx.fillStyle = warmGrad;
        ctx.beginPath();
        ctx.arc(ox, oy, radius * breath, 0, Math.PI * 2);
        ctx.fill();

        // Subtle boundary whisper ring showing exact illumination threshold
        ctx.strokeStyle = "rgba(255, 222, 148, 0.08)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(ox, oy, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Render floating dust motes ONLY inside the illuminated region
        for (let i = 0; i < this.dustMotes.length; i++) {
          const m = this.dustMotes[i];
          const d = Math.hypot(m.x - ox, m.y - oy);
          if (d < radius) {
            const falloff = 1 - d / radius;
            const twinkle = 0.55 + 0.45 * Math.sin(this.time * 3 + m.phase);
            ctx.fillStyle = `rgba(255, 236, 185, ${0.48 * falloff * twinkle})`;
            ctx.beginPath();
            ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.restore();
      }
    }

    renderWalls(ctx) {
      // Solid obsidian wall tops so light never bleeds across wall roofs
      ctx.fillStyle = "#0b0d14";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] === "#") {
            ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          }
        }
      }

      // Inner architectural bevel on wall tiles
      ctx.fillStyle = "#101522";
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (this.grid[r][c] === "#") {
            ctx.fillRect(c * TILE + 3, r * TILE + 3, TILE - 6, TILE - 6);
          }
        }
      }

      // Crisp exposed wall outlines + warm rim-lighting on faces oriented toward the Orb
      const ox = this.orb.x;
      const oy = this.orb.y;
      for (let i = 0; i < this.wallSegments.length - 4; i++) {
        const s = this.wallSegments[i];
        const mx = (s.x1 + s.x2) * 0.5;
        const my = (s.y1 + s.y2) * 0.5;
        const toOrbX = ox - mx;
        const toOrbY = oy - my;
        const dist = Math.hypot(toOrbX, toOrbY);
        const facing = toOrbX * s.nx + toOrbY * s.ny;

        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);

        if (facing > 0 && dist < this.lightRadius * 1.1) {
          const strength = clamp(1 - dist / (this.lightRadius * 1.1), 0, 1);
          ctx.strokeStyle = `rgba(148, 192, 245, ${0.22 + strength * 0.45})`;
          ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = "rgba(62, 78, 114, 0.35)";
          ctx.lineWidth = 1.2;
        }
        ctx.stroke();
      }
    }

    renderRipples(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.ripples.length; i++) {
        const r = this.ripples[i];
        ctx.strokeStyle = `rgba(${r.color}, ${Math.max(0, r.alpha)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    renderOrbAndSpirit(ctx) {
      // Recall comet streak when Orb flies back to player
      if (this.orb.recallComet) {
        const c = this.orb.recallComet;
        const t = clamp(c.progress, 0, 1);
        const ease = 1 - (1 - t) * (1 - t);
        const cx = lerp(c.fromX, this.player.x, ease);
        const cy = lerp(c.fromY, this.player.y, ease);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const grad = ctx.createLinearGradient(c.fromX, c.fromY, cx, cy);
        grad.addColorStop(0, "rgba(56, 226, 255, 0)");
        grad.addColorStop(1, "rgba(255, 220, 130, 0.85)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4 * (1 - t * 0.5);
        ctx.beginPath();
        ctx.moveTo(c.fromX, c.fromY);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        ctx.fillStyle = "#fff4c2";
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Subtle harmonic tether line when Light Orb is anchored
      if (this.orb.anchored && this.player.alive) {
        ctx.save();
        ctx.strokeStyle = "rgba(56, 226, 255, 0.16)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 7]);
        ctx.lineDashOffset = -this.time * 24;
        ctx.beginPath();
        ctx.moveTo(this.orb.x, this.orb.y);
        ctx.lineTo(this.player.x, this.player.y);
        ctx.stroke();
        ctx.restore();
      }

      // Draw Anchored Light Orb pedestal halo & core
      if (this.orb.anchored) {
        this.drawLightOrbGlyph(ctx, this.orb.x, this.orb.y, true);
      }

      // Draw Player Spirit
      if (this.player.alive) {
        const px = this.player.x;
        const py = this.player.y + Math.sin(this.time * 5.2) * 1.4;

        ctx.save();
        ctx.translate(px, py);

        // Spirit outer aura
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
        aura.addColorStop(0, "rgba(180, 245, 255, 0.7)");
        aura.addColorStop(0.55, "rgba(82, 214, 255, 0.25)");
        aura.addColorStop(1, "rgba(56, 226, 255, 0)");
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Spirit body
        ctx.fillStyle = "#e8f9ff";
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_RADIUS - 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#5ce1ff";
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Subtle expressive eyes oriented toward movement
        const ex = this.player.facingX * 2.6;
        const ey = this.player.facingY * 2.2;
        ctx.fillStyle = "#0b1324";
        ctx.beginPath();
        ctx.arc(ex - 2.6, ey - 0.5, 1.5, 0, Math.PI * 2);
        ctx.arc(ex + 2.6, ey - 0.5, 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Carried Light Orb orbiting gently above/beside the spirit
        if (!this.orb.anchored) {
          const orbitAngle = this.time * 2.4;
          const ox = px + Math.cos(orbitAngle) * 13;
          const oy = py - 9 + Math.sin(orbitAngle * 2) * 2;
          this.drawLightOrbGlyph(ctx, ox, oy, false);
        }
      }
    }

    drawLightOrbGlyph(ctx, x, y, anchored) {
      const scale = anchored ? 1.15 : 0.85;
      const pulse = 1 + 0.1 * Math.sin(this.time * 5.5);

      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = "lighter";

      if (anchored) {
        // Rotating cyan anchor sigil beneath dropped orb
        ctx.save();
        ctx.rotate(this.time * 1.4);
        ctx.strokeStyle = "rgba(56, 226, 255, 0.65)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, 15 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeRect(-9, -9, 18, 18);
        ctx.restore();
      }

      const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 22 * scale * pulse);
      glow.addColorStop(0, "rgba(255, 252, 230, 1)");
      glow.addColorStop(0.35, "rgba(255, 214, 102, 0.82)");
      glow.addColorStop(0.75, "rgba(255, 168, 38, 0.24)");
      glow.addColorStop(1, "rgba(255, 168, 38, 0)");

      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 22 * scale * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fffdf0";
      ctx.beginPath();
      ctx.arc(0, 0, 5.2 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    renderParticles(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * alpha), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Boot immediately once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new ShadowLightGame());
  } else {
    new ShadowLightGame();
  }
})();
