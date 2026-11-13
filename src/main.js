// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Game, TILE } from './game.js';
import { Textures } from './textures.js';
import { createVR } from './vr.js?v=hold-walk';

const UNIT = 2; // Size of each grid cell
const FLOOR_Y = -1;
const CEILING_Y = 1.65;
const EYE_Y = FLOOR_Y + 1.75;
const CRATE_HEIGHT = 1.3;
const WALK_MS = 260;
const CRATE_Y = FLOOR_Y + CRATE_HEIGHT / 2;

let scene, camera, renderer, controls;
let game, levelGroup, vr;
let isLoading = false;
let boxes = [];
let motion = null;
let currentLevel = 1;
const MAX_LEVELS = 50;
let levelInputBuffer = "";
let levelInputTimeout = null;
let isLevelCompleting = false;
let stats = { moves: 0, pushes: 0, rotations: 0 };
let moveStatsHistory = [];
let soundEnabled = localStorage.getItem('sokobanSound') !== 'off';
let audioContext = null;

const instructions = document.getElementById('instructions');
const mapOverlay = document.getElementById('map-overlay');
const mapCanvas = document.getElementById('map-canvas');
const mapStatus = document.getElementById('map-status');

init();

async function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ'; // Important for snapping
    
    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('game-container').appendChild(renderer.domElement);

    // 2. Controls
    controls = new PointerLockControls(camera, document.body);

    instructions.addEventListener('click', event => {
        if (renderer.xr.isPresenting || event.target.closest('#vr-controls')) return;
        initAudio();
        controls.lock();
    });

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        if (!renderer.xr.isPresenting) instructions.style.display = 'block';
    });

    // 3. Load Level
    await loadCurrentLevel();

    // 4. Input handling
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', onWindowResize);

    vr = createVR(renderer, scene, camera, {
        prepare: initAudio,
        enter() {
            updateMotion(Infinity);
            resetPlayerPosition();
            hideMap();
            instructions.style.display = 'none';
        },
        exit() {
            updateMotion(Infinity);
            resetPlayerPosition();
            onWindowResize();
            instructions.style.display = 'block';
        },
        move: moveAlong,
        turn: handleRotate,
        undo: handleUndo,
        restart: loadCurrentLevel,
        renderMap,
        canPlay: () => game?.width > 0 && !motion && !isLoading && !isLevelCompleting
    });
    renderer.setAnimationLoop(animate);
}

function onMouseDown(event) {
    if (!controls.isLocked || motion || isLoading || isLevelCompleting || renderer.xr.isPresenting) return;

    if (event.button === 0) { // Left: Forward
        triggerMove('forward');
    } else if (event.button === 2) { // Right: Backward
        triggerMove('backward');
    } else if (event.button === 1) { // Middle: Map
        showMap();
    }
}

function onMouseUp(event) {
    if (event.button === 1) { // Middle: Map
        hideMap();
    }
}

function triggerMove(direction) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    if (direction === 'backward') forward.negate();
    moveAlong(forward);
}

function moveAlong(direction, allowPush = true) {
    if (direction.lengthSq() === 0) return;
    if (Math.abs(direction.x) > Math.abs(direction.z)) {
        return handleMove(Math.sign(direction.x), 0, allowPush);
    } else {
        return handleMove(0, Math.sign(direction.z), allowPush);
    }
}

async function loadCurrentLevel(level = currentLevel) {
    if (isLoading) return;
    isLoading = true;
    try {
        const nextGame = new Game();
        const levelStr = level.toString().padStart(2, '0');
        await nextGame.loadLevel(`levels/level${levelStr}.txt`);
        game = nextGame;
        currentLevel = level;
        resetLevelStats();
        build3DLevel();
        resetPlayerPosition();
    } catch (e) {
        console.error("Error loading level:", e);
    } finally {
        isLoading = false;
        isLevelCompleting = false;
    }
}

function build3DLevel() {
    if (levelGroup) {
        scene.remove(levelGroup);
        const geometries = new Set();
        const materials = new Set();
        levelGroup.traverse(object => {
            if (!object.isMesh) return;
            geometries.add(object.geometry);
            materials.add(object.material);
            if (object.isInstancedMesh) object.dispose();
            if (object.userData.matNormal) {
                materials.add(object.userData.matNormal);
                materials.add(object.userData.matGoal);
            }
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
    }
    levelGroup = new THREE.Group();
    boxes = [];

    const wallGeo = new THREE.BoxGeometry(UNIT, CEILING_Y - FLOOR_Y, UNIT);
    const boxGeo = new THREE.BoxGeometry(UNIT * 0.8, CRATE_HEIGHT, UNIT * 0.8);
    const floorGeo = new THREE.PlaneGeometry(UNIT, UNIT);
    const goalGeo = new THREE.PlaneGeometry(UNIT * 0.5, UNIT * 0.5);

    const wallMat = new THREE.MeshBasicMaterial({ map: Textures.wall });
    const boxMat = new THREE.MeshBasicMaterial({ map: Textures.box });
    const boxOnGoalMat = new THREE.MeshBasicMaterial({ map: Textures.boxOnGoal });
    const floorMat = new THREE.MeshBasicMaterial({ map: Textures.floor });
    const ceilMat = new THREE.MeshBasicMaterial({ map: Textures.ceiling });
    const goalMat = new THREE.MeshBasicMaterial({ map: Textures.goal, transparent: true });

    const floors = [], ceilings = [], walls = [], goals = [];
    for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
            const tile = game.grid[y][x];
            const px = x * UNIT;
            const pz = y * UNIT;

            floors.push([px, FLOOR_Y, pz]);
            ceilings.push([px, CEILING_Y, pz]);

            if (tile === TILE.WALL) {
                walls.push([px, (FLOOR_Y + CEILING_Y) / 2, pz]);
            } else if (tile === TILE.BOX || tile === TILE.BOX_ON_GOAL) {
                const mat = tile === TILE.BOX_ON_GOAL ? boxOnGoalMat : boxMat;
                const box = new THREE.Mesh(boxGeo, mat);
                box.position.set(px, CRATE_Y, pz);
                box.userData = { gridX: x, gridY: y, matNormal: boxMat, matGoal: boxOnGoalMat };
                levelGroup.add(box);
                boxes.push(box);
            }

            if (tile === TILE.GOAL || tile === TILE.BOX_ON_GOAL || tile === TILE.PLAYER_ON_GOAL) {
                goals.push([px, FLOOR_Y + 0.01, pz]);
            }
        }
    }

    addTiles(floorGeo, floorMat, floors, -Math.PI / 2);
    addTiles(floorGeo, ceilMat, ceilings, Math.PI / 2);
    addTiles(wallGeo, wallMat, walls, 0);
    addTiles(goalGeo, goalMat, goals, -Math.PI / 2);
    if (!boxes.length) {
        boxGeo.dispose();
        boxMat.dispose();
        boxOnGoalMat.dispose();
    }

    function addTiles(geometry, material, positions, rotation) {
        const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
        const matrix = new THREE.Matrix4().makeRotationX(rotation);
        positions.forEach(([x, y, z], index) => {
            mesh.setMatrixAt(index, matrix.setPosition(x, y, z));
        });
        levelGroup.add(mesh);
    }

    scene.add(levelGroup);
}

function resetPlayerPosition() {
    if (!game) return;
    const x = game.playerPos.x * UNIT;
    const z = game.playerPos.y * UNIT;
    if (renderer.xr.isPresenting) vr.setTile(x, EYE_Y, z);
    else camera.position.set(x, EYE_Y, z);
}

function resetLevelStats() {
    stats = { moves: 0, pushes: 0, rotations: 0 };
    moveStatsHistory = [];
}

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function playTone(frequency, start, duration, volume = 0.04, type = 'square') {
    if (!soundEnabled || !audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime + start;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
}

function playSound(name) {
    if (!soundEnabled) return;
    initAudio();

    if (name === 'move') {
        playTone(520, 0, 0.035, 0.018);
    } else if (name === 'push') {
        playTone(165, 0, 0.055, 0.045);
        playTone(220, 0.045, 0.06, 0.035);
    } else if (name === 'blocked') {
        playTone(90, 0, 0.08, 0.035, 'sawtooth');
    } else if (name === 'rotate') {
        playTone(260, 0, 0.04, 0.016);
    } else if (name === 'undo') {
        playTone(440, 0, 0.035, 0.025);
        playTone(330, 0.04, 0.045, 0.025);
    } else if (name === 'win') {
        [523, 659, 784, 1047].forEach((freq, i) => playTone(freq, i * 0.08, 0.075, 0.035));
    } else if (name === 'toggle') {
        playTone(soundEnabled ? 880 : 220, 0, 0.06, 0.03);
    }
}

function toggleSound() {
    initAudio();
    soundEnabled = !soundEnabled;
    localStorage.setItem('sokobanSound', soundEnabled ? 'on' : 'off');
    playSound('toggle');
}

function onKeyDown(event) {
    if (isLevelCompleting || isLoading || renderer.xr.isPresenting) return;
    if (event.target?.closest?.('#vr-controls')) return;
    
    const key = event.key.toLowerCase();

    if (event.code === 'Space' && !controls.isLocked) {
        event.preventDefault();
        initAudio();
        controls.lock();
        return;
    }

    if (event.code === 'Tab') {
        event.preventDefault();
        showMap();
        return;
    }

    if (key === 'r') {
        if (!motion) loadCurrentLevel();
        return;
    }

    if (key === 'u') {
        handleUndo();
        return;
    }

    if (key === 'o') {
        toggleSound();
        return;
    }

    // Two-digit level selection
    if (!motion && event.key >= '0' && event.key <= '9') {
        levelInputBuffer += event.key;
        if (levelInputTimeout) clearTimeout(levelInputTimeout);
        
        if (levelInputBuffer.length === 2) {
            const levelNum = parseInt(levelInputBuffer);
            if (levelNum > 0 && levelNum <= MAX_LEVELS) {
                loadCurrentLevel(levelNum);
            }
            levelInputBuffer = "";
        } else {
            levelInputTimeout = setTimeout(() => {
                levelInputBuffer = "";
            }, 2000);
        }
        return;
    }

    if (!controls.isLocked || motion) return;

    let dx = 0, dy = 0;

    // Determine movement direction based on camera orientation
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    let moveDir = new THREE.Vector3(0, 0, 0);

    if (key === 'w' || event.code === 'ArrowUp') {
        moveDir.copy(forward);
    } else if (key === 's' || event.code === 'ArrowDown') {
        moveDir.copy(forward).negate();
    } else if (key === 'a' || event.code === 'ArrowLeft') {
        handleRotate(1); // Rotate Left
        return;
    } else if (key === 'd' || event.code === 'ArrowRight') {
        handleRotate(-1); // Rotate Right
        return;
    }

    if (moveDir.lengthSq() > 0) {
        if (Math.abs(moveDir.x) > Math.abs(moveDir.z)) {
            dx = Math.sign(moveDir.x);
        } else {
            dy = Math.sign(moveDir.z);
        }
        handleMove(dx, dy);
    }
}

function startMotion(duration, apply, finish, ease = smoothProgress) {
    motion = { start: performance.now(), duration, apply, finish, ease };
}

function smoothProgress(progress) {
    return THREE.MathUtils.smoothstep(progress, 0, 1);
}

function turnProgress(progress) {
    const ramp = 0.3;
    const cruiseSpeed = 1 / (1 - ramp);
    // Integrate a cosine speed ramp so velocity and acceleration ease into the turn.
    const edge = Math.min(progress, 1 - progress);
    if (edge >= ramp) return (progress - ramp / 2) * cruiseSpeed;
    const distance = (edge - ramp / Math.PI * Math.sin(Math.PI * edge / ramp)) * cruiseSpeed / 2;
    return progress <= 0.5 ? distance : 1 - distance;
}

function updateMotion(time) {
    if (!motion) return;
    const { start, duration, apply, finish, ease } = motion;
    const progress = THREE.MathUtils.clamp((time - start) / duration, 0, 1);
    apply(ease(progress));
    if (progress === 1) {
        motion = null;
        finish?.();
    }
}

function handleRotate(dir) {
    if (motion) return;
    stats.rotations++;
    playSound('rotate');

    const quarterTurn = Math.PI / 2;
    if (renderer.xr.isPresenting) {
        let previousAngle = 0;
        startMotion(500, progress => {
            const angle = dir * quarterTurn * progress;
            vr.rotateBy(angle - previousAngle);
            previousAngle = angle;
        }, undefined, turnProgress);
    } else {
        const start = camera.rotation.y;
        const target = (Math.round(start / quarterTurn) + dir) * quarterTurn;
        startMotion(240, progress => {
            camera.rotation.y = THREE.MathUtils.lerp(start, target, progress);
        });
    }
}

function handleUndo() {
    if (motion || isLoading || isLevelCompleting || !game) return;
    const prevState = game.undo();
    if (prevState) {
        const prevStats = moveStatsHistory.pop();
        if (prevStats) {
            stats.moves = prevStats.moves;
            stats.pushes = prevStats.pushes;
        }
        build3DLevel();
        resetPlayerPosition();
        playSound('undo');
    }
}

function onKeyUp(event) {
    if (event.code === 'Tab') {
        hideMap();
    }
}

function handleMove(dx, dy, allowPush = true) {
    if (!game || motion || isLoading || isLevelCompleting) return false;
    if (!allowPush) {
        const nextTile = game.getTile(game.playerPos.x + dx, game.playerPos.y + dy);
        if (nextTile !== TILE.FLOOR && nextTile !== TILE.GOAL) {
            playSound('blocked');
            return false;
        }
    }
    const result = game.tryMove(dx, dy);
    if (result.moved) {
        moveStatsHistory.push({ moves: stats.moves, pushes: stats.pushes });
        stats.moves++;
        if (result.pushedBox) stats.pushes++;
        playSound(result.pushedBox ? 'push' : 'move');
        const targetPos = new THREE.Vector3(game.playerPos.x * UNIT, EYE_Y, game.playerPos.y * UNIT);
        const startPos = new THREE.Vector3(targetPos.x - dx * UNIT, EYE_Y, targetPos.z - dy * UNIT);
        
        let boxMesh = null;
        let boxTarget = null;

        if (result.pushedBox) {
            boxMesh = boxes.find(b => b.userData.gridX === result.boxFrom.x && b.userData.gridY === result.boxFrom.y);
            if (boxMesh) {
                boxMesh.userData.gridX = result.boxTo.x;
                boxMesh.userData.gridY = result.boxTo.y;
                boxTarget = new THREE.Vector3(result.boxTo.x * UNIT, CRATE_Y, result.boxTo.y * UNIT);
            }
        }

        const wallAhead = game.getTile(game.playerPos.x + dx, game.playerPos.y + dy) === TILE.WALL;
        animateMove(startPos, targetPos, boxMesh, boxTarget, wallAhead);
    } else {
        playSound('blocked');
    }
    return result.moved;
}

function animateMove(startPos, targetPos, boxMesh, boxTarget, wallAhead) {
    const isVR = renderer.xr.isPresenting;
    const brake = isVR && wallAhead;
    // Doubling the duration lets ease-out start at normal walking speed.
    const ease = isVR ? (p => brake ? p * (2 - p) : p) : smoothProgress;
    const boxStart = boxMesh?.position.clone();
    const position = new THREE.Vector3();
    startMotion(brake ? WALK_MS * 2 : WALK_MS, progress => {
        position.lerpVectors(startPos, targetPos, progress);
        if (isVR) vr.setTile(position.x, position.y, position.z);
        else camera.position.copy(position);
        if (boxMesh) boxMesh.position.lerpVectors(boxStart, boxTarget, progress);
    }, () => finishMove(boxMesh, boxTarget), ease);
}

function finishMove(boxMesh, boxTarget) {
    if (boxMesh) {
        boxMesh.position.copy(boxTarget);
        const tile = game.getTile(boxMesh.userData.gridX, boxMesh.userData.gridY);
        boxMesh.material = tile === TILE.BOX_ON_GOAL ? boxMesh.userData.matGoal : boxMesh.userData.matNormal;
    }
    if (game.isWin()) {
        playSound('win');
        startLevelCompleteEffect();
    }
}

function startLevelCompleteEffect() {
    isLevelCompleting = true;
    let flashCount = 0;
    const maxFlashes = 12;
    const flashInterval = 100;

    const interval = setInterval(() => {
        flashCount++;
        boxes.forEach(box => {
            if (flashCount % 2 === 0) {
                box.material = box.userData.matNormal;
            } else {
                box.material = box.userData.matGoal;
            }
        });

        if (flashCount >= maxFlashes) {
            clearInterval(interval);
            boxes.forEach(box => box.material = box.userData.matGoal);
            setTimeout(() => {
                loadCurrentLevel(currentLevel % MAX_LEVELS + 1);
            }, 500);
        }
    }, flashInterval);
}

function showMap() {
    mapOverlay.style.display = 'flex';
    renderMap();
}

function hideMap() {
    mapOverlay.style.display = 'none';
}

function isMapVisible() {
    return window.getComputedStyle(mapOverlay).display !== 'none';
}

function updateMapStatus() {
    if (!mapStatus) return;
    mapStatus.textContent = `LEVEL ${currentLevel.toString().padStart(2, '0')}/${MAX_LEVELS} | MOVES ${stats.moves} | PUSHES ${stats.pushes} | ROTATIONS ${stats.rotations} | SOUND ${soundEnabled ? 'ON' : 'OFF'}`;
}

function renderMap(forward) {
    if (!game) return mapCanvas;
    const cellSize = 20;
    const width = game.width * cellSize;
    const height = game.height * cellSize;
    if (mapCanvas.width !== width || mapCanvas.height !== height) {
        mapCanvas.width = width;
        mapCanvas.height = height;
    }
    const ctx = mapCanvas.getContext('2d');

    ctx.fillStyle = '#55FFFF'; // Cyan floor
    ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

    for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
            const tile = game.grid[y][x];
            let color = null;

            if (tile === TILE.WALL) color = '#FF55FF'; // Pink wall
            else if (tile === TILE.BOX) color = '#FFFFFF'; // White box
            else if (tile === TILE.BOX_ON_GOAL) color = '#FFFF55'; // Yellow box (on goal)
            else if (tile === TILE.GOAL) color = '#000000'; // Black dots

            if (color) {
                ctx.fillStyle = color;
                if (tile === TILE.GOAL) {
                   ctx.fillRect(x * cellSize + 8, y * cellSize + 8, 4, 4);
                } else {
                   ctx.fillRect(x * cellSize, y * cellSize, cellSize - 1, cellSize - 1);
                }
            }

            if (tile === TILE.PLAYER || tile === TILE.PLAYER_ON_GOAL) {
                drawMapPlayer(ctx, x, y, cellSize, forward);
            }
        }
    }

    updateMapStatus();
    return mapCanvas;
}

function drawMapPlayer(ctx, x, y, cellSize, forward = camera.getWorldDirection(new THREE.Vector3())) {
    const left = x * cellSize;
    const top = y * cellSize;
    const centerX = left + cellSize / 2;
    const centerY = top + cellSize / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(left, top, cellSize - 1, cellSize - 1);

    let dx = 0, dy = 0;
    if (Math.abs(forward.x) > Math.abs(forward.z)) {
        dx = Math.sign(forward.x);
    } else {
        dy = Math.sign(forward.z);
    }

    // Draw a bright arrow pointing in the worker's current facing direction.
    ctx.fillStyle = '#55FFFF';
    ctx.beginPath();
    ctx.moveTo(centerX + dx * 7, centerY + dy * 7);
    ctx.lineTo(centerX - dx * 5 - dy * 5, centerY - dy * 5 + dx * 5);
    ctx.lineTo(centerX - dx * 5 + dy * 5, centerY - dy * 5 - dx * 5);
    ctx.closePath();
    ctx.fill();
}

function onWindowResize() {
    if (renderer.xr.isPresenting) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(time, frame) {
    if (frame) vr.update(frame);
    updateMotion(time);
    renderer.render(scene, camera);

    if (!frame && isMapVisible()) {
        renderMap();
    }
}
