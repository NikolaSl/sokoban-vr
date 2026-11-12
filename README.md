# Sokoban-VR

A small browser-based first-person Sokoban game using Three.js, with an immersive WebXR mode for Meta Quest.

## Motivation

I am a big fan of Sokoban and have been playing it since the 80s on an IBM PC with CGA graphics. This 3D/VR-style variant keeps the same colors and simple patterns to recall that nostalgic CGA vibe.

The goal is also harder here: the player does not have the whole level state visible all the time. You can recall the map with `TAB`, but the less you use the map, the better your spatial orientation and memory are. It is a bit like playing chess with closed eyes.

## Run

Play online: <https://nikolasl.github.io/sokoban-vr/>

To run locally:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open: <http://127.0.0.1:8000>

To host on another web server, copy the whole directory structure to the web server folder. No build step is required.

### Meta Quest 3

Serve this branch over HTTPS. Open the page directly in Meta Quest Browser and select **Enter VR** with a Touch controller. For local headset development, an HTTPS server with a certificate trusted by the headset works. For USB testing with developer mode enabled, run the local server above, run `adb reverse tcp:8000 tcp:8000` on the computer, then open `http://localhost:8000` in the headset browser.

Choose a **Quest controls** layout before selecting **Enter VR**. The game remembers your choice.

| Action | Two sticks (default) | Right hand only |
| --- | --- | --- |
| Move one tile | Left stick in any direction | Right trigger forward, right grip backward |
| Smooth turn 90° | Right stick left/right | Right stick left/right |
| Toggle map | A | A |
| Undo | B | B |
| Restart level | X | Click the right stick |

Movement is relative to where you face. Each step glides to the next tile, and crates slide when pushed. Release the input before the next step.

Start seated or standing in place. The game centers the starting view when you enter VR. Use the controller to cross tiles.

## License

MIT License

Copyright (c) 2026 Nikola Slavchev - LZ1NKL

See [LICENSE](LICENSE).

## Project structure

```text
index.html            App entry point
src/                  JavaScript game code
styles/               CSS
textures/             Game textures
levels/               Sokoban level files
```
