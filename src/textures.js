// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

import * as THREE from 'three';

const PALETTE = {
    CYAN: '#55FFFF',
    WHITE: '#FFFFFF'
};

const loader = new THREE.TextureLoader();

function loadTexture(path) {
    const texture = loader.load(path);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

function createGridTexture(baseColor, gridColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = gridColor;
    ctx.fillRect(0, 0, 1, 16);
    ctx.fillRect(0, 0, 16, 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

export const Textures = {
    wall: loadTexture('textures/wall.png'),
    box: loadTexture('textures/box.png'),
    boxOnGoal: loadTexture('textures/box-on-goal.png'),
    goal: loadTexture('textures/goal.png'),
    floor: createGridTexture(PALETTE.CYAN, '#00AAAA'),
    ceiling: createGridTexture(PALETTE.WHITE, '#AAAAAA')
};
