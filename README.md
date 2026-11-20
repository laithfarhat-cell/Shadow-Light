# Shadow & Light

A zero-dependency 2D atmospheric puzzle game built with vanilla **HTML5 Canvas**, **CSS3**, and modern **JavaScript (ES6+)**. Manipulate real-time raycast light and dynamic shadows to solidify distant bridges, silence light-sensitive sentries, and guide your spirit to the Exit Portal.

## Project Structure

- `index.html` — Minimal semantic markup, responsive centered canvas, HUD overlay, and victory screen.
- `style.css` — Dark atmospheric styling (`#0b0d13`), subtle neon glow aesthetics, and responsive layout.
- `game.js` — Complete 60 FPS game engine, 2D visibility polygon / shadow-casting algorithm, deterministic `isPointLit(x, y)` hit detection, physics, particle effects, and modular `LEVELS` array.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / `Arrow Keys` | Move Spirit |
| `Space` | Drop / Anchor or Recall the Light Orb |
| `R` | Quick-restart current chamber |

## Puzzle Elements

1. **Solid Walls (`#`)** — Block both movement and light rays, casting crisp real-time shadows.
2. **Shadow Bridges (`=`, Cyan)** — Translucent chasm tiles that crystallize and become walkable **only when illuminated** by the Light Orb.
3. **Light-Sensitive Sentries (`^`, Crimson)** — Deadly spike nodes that activate **only when hit by light**. Hide them inside a wall's shadow to pass safely.
4. **Exit Portal (`E`, Gold)** — Advances to the next chamber upon contact.

## Running Locally or on GitHub Pages

No build step, bundler, or external assets required:

1. Open `index.html` directly in any modern browser, **or** serve locally (`python3 -m http.server 8000`).
2. To host on **GitHub Pages**, enable Pages from your repository settings pointing to the root (`/`) of your branch.

## Adding Custom Levels

Open `game.js` and append a new level object (`24 × 14` ASCII grid) to the `LEVELS` array using `#`, `.`, `~`, `=`, `^`, `S`, `E`, and `*`.
