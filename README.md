# Sokoban-VR

A small browser-based first-person Sokoban game using Three.js.

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
