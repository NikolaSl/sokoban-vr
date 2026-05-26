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
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    // Keep the old CGA grid feeling, but add a subtle beveled tile edge.
    ctx.fillStyle = gridColor;
    ctx.fillRect(0, 0, 6, size);
    ctx.fillRect(0, 0, size, 6);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(8, 8, size - 16, 4);
    ctx.fillRect(8, 8, 4, size - 16);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(8, size - 12, size - 16, 4);
    ctx.fillRect(size - 12, 8, 4, size - 16);

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
