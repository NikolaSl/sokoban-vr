// Copyright (c) 2026 Nikola Slavchev - LZ1NKL
// Licensed under the MIT License. See LICENSE for details.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const STICK_PRESS = 0.7;
const STICK_RELEASE = 0.3;

export function createVR(renderer, scene, camera, actions) {
    const button = document.getElementById('enter-vr');
    const status = document.getElementById('vr-status');
    const layout = document.getElementById('vr-layout');
    const layoutHelp = document.getElementById('vr-layout-help');
    const rig = new THREE.Group();
    const head = new THREE.Vector3();
    const orientation = new THREE.Quaternion();
    const inverseRotation = new THREE.Quaternion();
    const forward = new THREE.Vector3();
    const heading = new THREE.Vector3(0, 0, -1);
    const tile = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const pivot = new THREE.Vector3();
    const savedRotation = new THREE.Quaternion();
    const map = new THREE.Sprite(new THREE.SpriteMaterial({
        depthTest: false, depthWrite: false, toneMapped: false
    }));
    map.visible = false;
    map.renderOrder = 1;
    map.frustumCulled = false;
    scene.add(rig, map);

    let calibrated = false;
    let mapWidth = 0, mapHeight = 0;
    let pending = false;
    const inputStates = new Map();
    let rightHandOnly = localStorage.getItem('sokobanVRLayout') === 'right-hand';
    layout.value = rightHandOnly ? 'right-hand' : 'two-stick';
    updateLayoutHelp();
    layout.addEventListener('change', () => {
        rightHandOnly = layout.value === 'right-hand';
        localStorage.setItem('sokobanVRLayout', layout.value);
        updateLayoutHelp();
    });

    function updateLayoutHelp() {
        layoutHelp.textContent = rightHandOnly
            ? 'Right stick turns · Trigger forward · Grip backward · A map · B undo · Stick click restarts'
            : 'Left stick moves · Right stick turns · A map · B undo · X restart';
    }

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    checkSupport();

    async function checkSupport() {
        if (!window.isSecureContext) {
            showStatus('VR requires HTTPS.');
            return;
        }
        try {
            if (await navigator.xr?.isSessionSupported('immersive-vr')) {
                document.getElementById('vr-controls').hidden = false;
            }
        } catch (error) {
            console.warn('Could not check VR support:', error);
        }
    }

    function showStatus(message) {
        status.textContent = message;
        status.hidden = !message;
    }

    button.addEventListener('click', async event => {
        event.stopPropagation();
        if (pending || !actions.canPlay()) return;
        pending = true;
        button.disabled = true;
        layout.disabled = true;
        showStatus('');
        let session;
        try {
            actions.prepare();
            session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['layers']
            });
            savedRotation.copy(camera.quaternion);
            tile.copy(camera.position);
            origin.set(0, 0, 0);
            rig.rotation.set(0, 0, 0);
            rig.position.copy(tile);
            calibrated = false;
            heading.set(0, 0, -1);
            inputStates.clear();
            rig.add(camera);
            session.addEventListener('end', restoreDesktop, { once: true });
            session.addEventListener('inputsourceschange', event => {
                for (const source of event.removed) inputStates.delete(source);
            });
            await renderer.xr.setSession(session);
            actions.enter();
        } catch (error) {
            console.error('Could not enter VR:', error);
            if (session) {
                await session.end().catch(() => {});
                if (camera.parent === rig) restoreDesktop();
            }
            showStatus('Could not enter VR. Try again in the Quest Browser.');
        } finally {
            pending = false;
            button.disabled = false;
            layout.disabled = false;
        }
    });

    function restoreDesktop() {
        map.visible = false;
        rig.remove(camera);
        camera.quaternion.copy(savedRotation);
        // Three.js restores the session render target and XR state in its end listener.
        queueMicrotask(actions.exit);
    }

    function positionRig() {
        rig.position.copy(tile).sub(offset.copy(origin).applyQuaternion(rig.quaternion));
    }

    function setTile(x, y, z) {
        tile.set(x, y, z);
        positionRig();
    }

    function rotateBy(angle) {
        // Pivot around the viewer's horizontal position, including when leaning.
        pivot.copy(head).applyQuaternion(rig.quaternion).add(rig.position);
        rig.rotateY(angle);
        heading.applyAxisAngle(UP, angle);
        rig.position.copy(pivot).sub(offset.copy(head).applyQuaternion(rig.quaternion));
        origin.copy(tile).sub(rig.position).applyQuaternion(inverseRotation.copy(rig.quaternion).invert());
    }

    function update(frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const pose = referenceSpace && frame.getViewerPose(referenceSpace);
        if (!pose) return;
        const { position, orientation: rotation } = pose.transform;
        head.set(position.x, position.y, position.z);
        orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
        if (!calibrated) {
            origin.copy(head);
            positionRig();
            calibrated = true;
        }

        for (const source of frame.session.inputSources) {
            if (source.hand || source.gamepad?.mapping !== 'xr-standard') continue;
            readController(source);
        }

        if (map.visible) updateMap();
    }

    function getHeading() {
        forward.set(0, 0, -1).applyQuaternion(orientation).applyQuaternion(rig.quaternion);
        forward.y = 0;
        // Keep the last heading when looking almost straight up or down.
        if (forward.lengthSq() > 0.01) heading.copy(forward).normalize();
        return heading;
    }

    function readController(source) {
        const isRight = source.handedness === 'right';
        if (rightHandOnly && !isRight) return;

        const { axes, buttons } = source.gamepad;
        const x = axes[2] ?? 0;
        const y = axes[3] ?? 0;
        const magnitude = isRight ? Math.abs(x) : Math.max(Math.abs(x), Math.abs(y));
        let state = inputStates.get(source);
        if (!state) {
            state = { stick: true, buttons: [] };
            inputStates.set(source, state);
        }

        const stickPressed = !state.stick && magnitude >= STICK_PRESS;
        if (magnitude >= STICK_PRESS) state.stick = true;
        if (magnitude <= STICK_RELEASE) state.stick = false;

        function justPressed(index) {
            const pressed = Boolean(buttons[index]?.pressed);
            const edge = pressed && state.buttons[index] === false;
            state.buttons[index] = pressed;
            return edge;
        }

        // xr-standard slots 0–3 are trigger, squeeze, touchpad, and thumbstick.
        const firstPressed = justPressed(4);
        const secondPressed = justPressed(5);
        const triggerPressed = rightHandOnly && justPressed(0);
        const gripPressed = rightHandOnly && justPressed(1);
        const stickClicked = rightHandOnly && justPressed(3);
        if (!actions.canPlay()) return;

        if (isRight) {
            if (firstPressed) map.visible = !map.visible;
            if (secondPressed) actions.undo();
            else if (stickClicked) actions.restart();
            else if (stickPressed) actions.turn(-Math.sign(x));
            else if (triggerPressed !== gripPressed) {
                const direction = forward.copy(getHeading());
                if (gripPressed) direction.negate();
                actions.move(direction);
            }
        } else if (source.handedness === 'left') {
            if (firstPressed) {
                actions.restart();
            } else if (stickPressed) {
                const direction = forward.copy(getHeading());
                if (Math.abs(x) > Math.abs(y)) {
                    direction.applyAxisAngle(UP, -Math.sign(x) * Math.PI / 2);
                } else if (y > 0) {
                    direction.negate();
                }
                actions.move(direction);
            }
        }
    }

    function updateMap() {
        const canvas = actions.renderMap(getHeading());
        if (canvas.width !== mapWidth || canvas.height !== mapHeight) {
            map.material.map?.dispose();
            const texture = new THREE.CanvasTexture(canvas);
            texture.generateMipmaps = false;
            texture.minFilter = texture.magFilter = THREE.NearestFilter;
            texture.colorSpace = THREE.SRGBColorSpace;
            map.material.map = texture;
            map.material.needsUpdate = true;
            mapWidth = canvas.width;
            mapHeight = canvas.height;
            const scale = 0.9 / Math.max(mapWidth, mapHeight);
            map.scale.set(mapWidth * scale, mapHeight * scale, 1);
        }
        map.material.map.needsUpdate = true;
        forward.set(0, 0, -1.3).applyQuaternion(orientation);
        map.position.copy(head).add(forward).applyQuaternion(rig.quaternion).add(rig.position);
    }

    return { setTile, rotateBy, update };
}
