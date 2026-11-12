// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Game, TILE } from './game.js';
import { Textures } from './textures.js';
import { createVR } from './vr.js';

const UNIT = 2; // Size of each grid cell

let scene, camera, renderer, controls;
let game, levelGroup, vr;
let isLoading = false;
let boxes = [];
let isMoving = false;
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
            resetPlayerPosition();
            hideMap();
            instructions.style.display = 'none';
        },
        exit() {
            resetPlayerPosition();
            onWindowResize();
            instructions.style.display = 'block';
        },
        move: moveAlong,
        turn() {
            stats.rotations++;
            playSound('rotate');
        },
        undo: handleUndo,
        restart: loadCurrentLevel,
        renderMap,
        canPlay: () => game?.width > 0 && !isMoving && !isLoading && !isLevelCompleting
    });
    renderer.setAnimationLoop(animate);
}

function onMouseDown(event) {
    if (!controls.isLocked || isMoving || isLoading || isLevelCompleting || renderer.xr.isPresenting) return;

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

function moveAlong(direction) {
    if (direction.lengthSq() === 0) return;
    if (Math.abs(direction.x) > Math.abs(direction.z)) {
        handleMove(Math.sign(direction.x), 0);
    } else {
        handleMove(0, Math.sign(direction.z));
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

    const wallGeo = new THREE.BoxGeometry(UNIT, UNIT, UNIT);
    const boxGeo = new THREE.BoxGeometry(UNIT * 0.8, UNIT * 0.8, UNIT * 0.8);
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

            floors.push([px, -UNIT / 2, pz]);
            ceilings.push([px, UNIT / 2, pz]);

            if (tile === TILE.WALL) {
                walls.push([px, 0, pz]);
            } else if (tile === TILE.BOX || tile === TILE.BOX_ON_GOAL) {
                const mat = tile === TILE.BOX_ON_GOAL ? boxOnGoalMat : boxMat;
                const box = new THREE.Mesh(boxGeo, mat);
                box.position.set(px, -UNIT * 0.1, pz);
                box.userData = { gridX: x, gridY: y, matNormal: boxMat, matGoal: boxOnGoalMat };
                levelGroup.add(box);
                boxes.push(box);
            }

            if (tile === TILE.GOAL || tile === TILE.BOX_ON_GOAL || tile === TILE.PLAYER_ON_GOAL) {
                goals.push([px, -UNIT / 2 + 0.01, pz]);
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
    if (renderer.xr.isPresenting) vr.setTile(x, z);
    else camera.position.set(x, 0, z);
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
        if (!isMoving) loadCurrentLevel();
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
    if (!isMoving && event.key >= '0' && event.key <= '9') {
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

    if (!controls.isLocked || isMoving) return;

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

function handleRotate(dir) {
    if (isMoving) return;
    isMoving = true;
    stats.rotations++;
    playSound('rotate');

    const startRotation = camera.rotation.y;
    // Snap current rotation to nearest 90 before adding next 90
    const snappedStart = Math.round(startRotation / (Math.PI / 2)) * (Math.PI / 2);
    const targetRotation = snappedStart + (dir * Math.PI / 2);

    const startTime = performance.now();
    const duration = 200; // ms

    function step() {
        if (renderer.xr.isPresenting) {
            isMoving = false;
            return;
        }
        const now = performance.now();
        const t = Math.min(1, (now - startTime) / duration);
        const ease = t; 

        camera.rotation.y = THREE.MathUtils.lerp(snappedStart, targetRotation, ease);

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            camera.rotation.y = targetRotation;
            isMoving = false;
        }
    }
    requestAnimationFrame(step);
}

function handleUndo() {
    if (isMoving || isLoading || isLevelCompleting || !game) return;
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

function handleMove(dx, dy) {
    if (!game || isMoving || isLoading || isLevelCompleting) return;
    const result = game.tryMove(dx, dy);
    if (result.moved) {
        moveStatsHistory.push({ moves: stats.moves, pushes: stats.pushes });
        stats.moves++;
        if (result.pushedBox) stats.pushes++;
        playSound(result.pushedBox ? 'push' : 'move');
        isMoving = true;
        const targetPos = new THREE.Vector3(game.playerPos.x * UNIT, 0, game.playerPos.y * UNIT);
        
        let boxMesh = null;
        let boxTarget = null;

        if (result.pushedBox) {
            boxMesh = boxes.find(b => b.userData.gridX === result.boxFrom.x && b.userData.gridY === result.boxFrom.y);
            if (boxMesh) {
                boxMesh.userData.gridX = result.boxTo.x;
                boxMesh.userData.gridY = result.boxTo.y;
                boxTarget = new THREE.Vector3(result.boxTo.x * UNIT, -UNIT * 0.1, result.boxTo.y * UNIT);
            }
        }

        if (renderer.xr.isPresenting) {
            vr.setTile(targetPos.x, targetPos.z);
            finishMove(boxMesh, boxTarget);
        } else {
            animateMove(targetPos, boxMesh, boxTarget);
        }
    } else {
        playSound('blocked');
    }
}

function animateMove(targetPos, boxMesh, boxTarget) {
    const startPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 200; // ms

    function step() {
        if (renderer.xr.isPresenting) {
            vr.setTile(targetPos.x, targetPos.z);
            finishMove(boxMesh, boxTarget);
            return;
        }
        const now = performance.now();
        const t = Math.min(1, (now - startTime) / duration);
        const ease = t; 

        camera.position.lerpVectors(startPos, targetPos, ease);
        if (boxMesh && boxTarget) {
            boxMesh.position.x = THREE.MathUtils.lerp(boxMesh.position.x, boxTarget.x, ease);
            boxMesh.position.z = THREE.MathUtils.lerp(boxMesh.position.z, boxTarget.z, ease);
        }

        if (t < 1) {
            requestAnimationFrame(step);
        } else {
            camera.position.copy(targetPos);
            finishMove(boxMesh, boxTarget);
        }
    }
    requestAnimationFrame(step);
}

function finishMove(boxMesh, boxTarget) {
    if (boxMesh) {
        boxMesh.position.copy(boxTarget);
        const tile = game.getTile(boxMesh.userData.gridX, boxMesh.userData.gridY);
        boxMesh.material = tile === TILE.BOX_ON_GOAL ? boxMesh.userData.matGoal : boxMesh.userData.matNormal;
    }
    isMoving = false;
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
    renderer.render(scene, camera);

    if (!frame && isMapVisible()) {
        renderMap();
    }
}
