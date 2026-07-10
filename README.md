# RUE & NERO'S PSYCHEDELIC ODYSSEY

A Super Mario World-style platformer starring two very good dogs — **Rue**
(the balanced, brave chi-mix) and **Nero** (the zoomy Italian Greyhound —
faster, floatier, slides more) — exploring an Alex Grey-inspired dreamscape.

Two full render modes on one shared engine ("PAWS engine"):

- **🎨 Classic 2D** — pixel-art sprites composited through a psychedelic
  WebGL shader.
- **🌀 3D Odyssey** — Three.js scene with HDR bloom, feedback trails,
  chromatic aberration, kaleidoscope skydome.

**Each mode has its own 32-dream campaign** — 8 worlds × 4 levels,
Super Mario World-style variety with a psychedelic twist: meadows,
neon caverns, sky gardens with **bounce blooms**, mushroom forests,
ghost parlors, prism peaks, geometric fortresses, and a star world.
Every level hides **5 squeaky tennis balls** 🎾 (the dragon coins of
this universe) alongside the cosmic-bone trail.

**🏔 Free Roam — Dreamland 64** — an open-world mode: one big
explorable dream island with camera-relative analog movement and an
orbit camera (right stick or Q/E; auto-follows on touch). Climb the
spiral mountain to the Great Eye, ride bounce blooms to the cloud,
scale the lotus stairway, wade the dream lake — and find the
**7 Zoomie Stars** (one only appears after 60 cosmic bones). Touch
a checkpoint crystal to attune your respawn; falling off the island
just means the dream tide carries you back.

**Multiplayer** 🐾🐾 — two ways to play together:

- **Couch co-op**: both pups on one screen. P1 = arrows + Z/X/C (or
  gamepad 1), P2 = WASD + Space/Q/E (or gamepad 2). The camera follows
  the leader; a trailing pup gets catch-up zoomies, never left behind.
- **Online co-op**: host a room, share the 4-letter code, and a friend
  joins from anywhere — straight from the game link, phones included
  (WebRTC via PeerJS; needs internet for the handshake). Each player
  is their own pup with zero-lag local controls.

In co-op the dream never ends — out of hearts just means a quick nap
and right back to the zoomies.

Level progress, best scores, and tennis-ball finds are saved locally.
Finishing a dream unlocks the next one. Nobody ever gets hurt in this
game — when the hearts run out (solo), the dream just drifts home and
the pup wakes up cozy.

## Play it locally

The game needs a local web server (ES modules don't load from `file://`):

```
cd rues-psychedelic-odyssey
python -m http.server 5217
```

Open **http://localhost:5217**. (`classic.html` is the original v1 archive.)

## Controls

| Action        | Xbox controller    | Keyboard         | Touch            |
|---------------|--------------------|------------------|------------------|
| Move          | Left stick / D-pad | ← → or A / D     | ◀ ▶ pad          |
| Jump          | **A**              | Z / Space / ↑    | Ⓐ button         |
| Spin jump     | **B**              | C or B           | 🌀 button        |
| Run (hold)    | **X** / RB / RT    | Shift or X       | RUN button       |
| Pause         | **Menu (Start)**   | P / Enter / Esc  | ⏸ button         |
| Music toggle  | **Y**              | M                | ♪ button         |
| Menu navigate | stick + **A**/**B**| arrows + Enter/Esc | tap            |
| Fullscreen    | —                  | F                | ⚙ settings      |

Touch controls appear automatically on phones/tablets (or force them
on/off in ⚙ settings). Settings also cover music/SFX volume, **trip
intensity** (how hard the visuals breathe), and 3D quality for weaker GPUs.

> Sound note: browsers need one tap/click/keypress before audio can start.

## Hosting online (free options)

The whole folder is a static site — no build step, no server code:

- **itch.io** (best for sharing a game): create a project, set
  *Kind of project* to **HTML**, upload `rue-odyssey-web.zip`, tick
  **"This file will be played in the browser"**, set viewport to fullscreen,
  publish. Friends get a nice game page that also works on their phones.
- **GitHub Pages**: push this folder to a repo, enable Pages on the main
  branch. Game appears at `https://<user>.github.io/<repo>/`.
- **Netlify / Cloudflare Pages**: drag-and-drop the folder in their web UI.
- **Same-WiFi quick share**: run the python server above and friends on
  your network can open `http://<your-LAN-IP>:5217`.

## Code layout (PAWS engine)

```
index.html      shell: canvases, touch UI, menu panels, CSS
js/shared.js    save/settings · audio engine · unified input · level DSL + levels · characters
js/logic.js     renderer-agnostic gameplay (fixed 60 Hz): physics, entities, states
js/render2d.js  classic renderer (pixel canvas + WebGL composite shader)
js/render3d.js  odyssey renderer (Three.js + custom HDR post pipeline)
js/main.js      menus, settings, HUD, touch wiring, game loop
lib/three.module.js  vendored Three.js r164 (fully offline)
```

Adding a level = one builder function in `js/shared.js` (`LEVELS` registry).
Adding a character = one entry in `CHARS` (palette + shape + 3D rig + stats).
