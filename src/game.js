// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

export const TILE = {
    WALL: '#',
    PLAYER: '@',
    BOX: '$',
    GOAL: '.',
    FLOOR: ' ',
    BOX_ON_GOAL: '*',
    PLAYER_ON_GOAL: '+'
};

export class Game {
    constructor() {
        this.grid = [];
        this.playerPos = { x: 0, y: 0 };
        this.width = 0;
        this.height = 0;
        this.history = []; // Store grid states
    }

    async loadLevel(url) {
        const response = await fetch(url);
        const text = await response.text();
        const lines = text.split('\n');
        
        this.height = lines.length;
        this.width = Math.max(...lines.map(l => l.length));
        
        this.grid = Array.from({ length: this.height }, () => Array(this.width).fill(TILE.FLOOR));
        this.history = [];
        
        lines.forEach((line, y) => {
            for (let x = 0; x < line.length; x++) {
                const char = line[x];
                this.grid[y][x] = char;
                if (char === TILE.PLAYER || char === TILE.PLAYER_ON_GOAL) {
                    this.playerPos = { x, y };
                }
            }
        });
    }

    getTile(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return TILE.WALL;
        return this.grid[y][x];
    }

    setTile(x, y, type) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.grid[y][x] = type;
        }
    }

    saveHistory() {
        const state = {
            grid: this.grid.map(row => [...row]),
            playerPos: { ...this.playerPos }
        };
        this.history.push(state);
    }

    undo() {
        if (this.history.length === 0) return null;
        const prevState = this.history.pop();
        this.grid = prevState.grid;
        this.playerPos = prevState.playerPos;
        return prevState;
    }

    tryMove(dx, dy) {
        const nx = this.playerPos.x + dx;
        const ny = this.playerPos.y + dy;
        const target = this.getTile(nx, ny);

        // Move into empty space or goal
        if (target === TILE.FLOOR || target === TILE.GOAL) {
            this.saveHistory();
            this.updatePlayer(nx, ny);
            return { moved: true, pushedBox: false };
        }

        // Try pushing box
        if (target === TILE.BOX || target === TILE.BOX_ON_GOAL) {
            const bx = nx + dx;
            const by = ny + dy;
            const behindBox = this.getTile(bx, by);

            if (behindBox === TILE.FLOOR || behindBox === TILE.GOAL) {
                this.saveHistory();
                
                // Move box
                const newBoxType = behindBox === TILE.GOAL ? TILE.BOX_ON_GOAL : TILE.BOX;
                this.setTile(bx, by, newBoxType);
                
                // Clear old box position
                const oldBoxTarget = target === TILE.BOX_ON_GOAL ? TILE.GOAL : TILE.FLOOR;
                this.setTile(nx, ny, oldBoxTarget);
                
                // Move player
                this.updatePlayer(nx, ny);
                return { moved: true, pushedBox: true, boxFrom: { x: nx, y: ny }, boxTo: { x: bx, y: by } };
            }
        }

        return { moved: false };
    }

    updatePlayer(nx, ny) {
        // Clear current player pos
        const currentTile = this.getTile(this.playerPos.x, this.playerPos.y);
        const clearedTile = currentTile === TILE.PLAYER_ON_GOAL ? TILE.GOAL : TILE.FLOOR;
        this.setTile(this.playerPos.x, this.playerPos.y, clearedTile);

        // Set new player pos
        const targetTile = this.getTile(nx, ny);
        const newPlayerTile = targetTile === TILE.GOAL ? TILE.PLAYER_ON_GOAL : TILE.PLAYER;
        this.setTile(nx, ny, newPlayerTile);
        this.playerPos = { x: nx, y: ny };
    }

    isWin() {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (this.grid[y][x] === TILE.BOX) return false;
            }
        }
        return true;
    }
}
