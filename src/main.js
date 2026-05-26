// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Game, TILE } from './game.js';
import { Textures } from './textures.js';

const UNIT = 2; // Size of each grid cell

let scene, camera, renderer, controls;
let game, levelGroup;
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

    instructions.addEventListener('click', () => {
        initAudio();
        controls.lock();
    });

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        instructions.style.display = 'block';
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

    animate();
}

function onMouseDown(event) {
    if (!controls.isLocked || isMoving) return;

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

    let moveDir = new THREE.Vector3(0, 0, 0);
    if (direction === 'forward') {
        moveDir.copy(forward);
    } else if (direction === 'backward') {
        moveDir.copy(forward).negate();
    }

    if (moveDir.lengthSq() > 0) {
        let dx = 0, dy = 0;
        if (Math.abs(moveDir.x) > Math.abs(moveDir.z)) {
            dx = Math.sign(moveDir.x);
        } else {
            dy = Math.sign(moveDir.z);
        }
        handleMove(dx, dy);
    }
}

async function loadCurrentLevel() {
    game = new Game();
    const levelStr = currentLevel.toString().padStart(2, '0');
    try {
        await game.loadLevel(`levels/level${levelStr}.txt`);
        resetLevelStats();
        build3DLevel();
        resetPlayerPosition();
        isLevelCompleting = false;
    } catch (e) {
        console.error("Error loading level:", e);
        if (currentLevel > 1) {
            alert("Level not found. Returning to Level 1.");
            currentLevel = 1;
            await loadCurrentLevel();
        }
    }
}

function build3DLevel() {
    if (levelGroup) scene.remove(levelGroup);
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

    for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
            const tile = game.grid[y][x];
            const px = x * UNIT;
            const pz = y * UNIT;

            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.set(px, -UNIT/2, pz);
            levelGroup.add(floor);

            const ceil = new THREE.Mesh(floorGeo, ceilMat);
            ceil.rotation.x = Math.PI / 2;
            ceil.position.set(px, UNIT/2, pz);
            levelGroup.add(ceil);

            if (tile === TILE.WALL) {
                const wall = new THREE.Mesh(wallGeo, wallMat);
                wall.position.set(px, 0, pz);
                levelGroup.add(wall);
            } else if (tile === TILE.BOX || tile === TILE.BOX_ON_GOAL) {
                const mat = tile === TILE.BOX_ON_GOAL ? boxOnGoalMat : boxMat;
                const box = new THREE.Mesh(boxGeo, mat);
                box.position.set(px, -UNIT * 0.1, pz);
                box.userData = { gridX: x, gridY: y, matNormal: boxMat, matGoal: boxOnGoalMat };
                levelGroup.add(box);
                boxes.push(box);
            }

            if (tile === TILE.GOAL || tile === TILE.BOX_ON_GOAL || tile === TILE.PLAYER_ON_GOAL) {
                const goal = new THREE.Mesh(goalGeo, goalMat);
                goal.rotation.x = -Math.PI / 2;
                goal.position.set(px, -UNIT/2 + 0.01, pz);
                levelGroup.add(goal);
            }
        }
    }

    scene.add(levelGroup);
}

function resetPlayerPosition() {
    camera.position.set(game.playerPos.x * UNIT, 0, game.playerPos.y * UNIT);
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
    if (isLevelCompleting) return;
    
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
        loadCurrentLevel();
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
    if (event.key >= '0' && event.key <= '9') {
        levelInputBuffer += event.key;
        if (levelInputTimeout) clearTimeout(levelInputTimeout);
        
        if (levelInputBuffer.length === 2) {
            const levelNum = parseInt(levelInputBuffer);
            if (levelNum > 0 && levelNum <= MAX_LEVELS) {
                currentLevel = levelNum;
                loadCurrentLevel();
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
    if (isMoving) return;
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

        animateMove(targetPos, boxMesh, boxTarget);
    } else {
        playSound('blocked');
    }
}

function animateMove(targetPos, boxMesh, boxTarget) {
    const startPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 200; // ms

    function step() {
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
            if (boxMesh) {
                boxMesh.position.copy(boxTarget);
                const tile = game.getTile(boxMesh.userData.gridX, boxMesh.userData.gridY);
                boxMesh.material = (tile === TILE.BOX_ON_GOAL) ? boxMesh.userData.matGoal : boxMesh.userData.matNormal;
            }
            isMoving = false;
            if (game.isWin()) {
                playSound('win');
                startLevelCompleteEffect();
            }
        }
    }
    requestAnimationFrame(step);
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
                currentLevel++;
                loadCurrentLevel();
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

function renderMap() {
    const cellSize = 20;
    mapCanvas.width = game.width * cellSize;
    mapCanvas.height = game.height * cellSize;
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
                drawMapPlayer(ctx, x, y, cellSize);
            }
        }
    }

    updateMapStatus();
}

function drawMapPlayer(ctx, x, y, cellSize) {
    const left = x * cellSize;
    const top = y * cellSize;
    const centerX = left + cellSize / 2;
    const centerY = top + cellSize / 2;

    ctx.fillStyle = '#000000';
    ctx.fillRect(left, top, cellSize - 1, cellSize - 1);

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);

    if (isMapVisible()) {
        renderMap();
    }
}
