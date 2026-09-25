// A live copy of Jade Shell's dock, for jadeshell.app. The numbers, curves and
// timings are the dock's own: extension/lib/dock/bar.js (magnification),
// items.js (bounce) and genie.js (minimize), in the jade-shell repository.
// Everything is laid out in the desktop's logical pixels (1400×900, the test
// desktop the backdrop was captured on; 700 wide on phones) and scaled to fit.

const REACH = 6;             // slots the magnification spans
const SPRING = 20;           // rad/s: in and out in about a fifth of a second
const CURSOR_TAU = 0.045;    // s: smooths the pointer against the frame clock
const MAX_DT = 1 / 30;
const MAX_SCALE = 1.6;       // dock-magnification's default
const ICON = 48;             // dock-icon-size's default

const BOUNCE_MS = 330;       // one hop: up with gravity slowing it, down speeding it up
const LAUNCH_HEIGHT = 0.55;  // of an icon
const PRESSED_DARK = 0.28;

const MINIMIZE_MS = 560;
const UNMINIMIZE_MS = 480;
const X_TILES = 6;
const Y_TILES = 48;

const H = 900;
const smooth = u => u * u * (3 - 2 * u);
const clamp01 = u => Math.min(1, Math.max(0, u));
const easeOutQuad = t => 1 - (1 - t) * (1 - t);
const easeInQuad = t => t * t;

const APPS = [
    {id: 'files', name: 'Files', running: true},
    {id: 'firefox', name: 'Firefox'},
    {id: 'terminal', name: 'Terminal'},
    {id: 'calendar', name: 'Calendar'},
    {id: 'editor', name: 'Text Editor'},
    {id: 'vscode', name: 'Visual Studio Code'},
    {id: 'calculator', name: 'Calculator'},
    {id: 'weather', name: 'Weather'},
    {id: 'settings', name: 'Settings'},
    {separator: true},
    {id: 'apps', name: 'Show Apps', tool: true},
    {id: 'trash', name: 'Trash', tool: true},
];

// The Files window, as captured: 800×500 with GNOME's minimize and close
// buttons (centres, in the capture's pixels).
const WINDOW = {width: 800, height: 500, minimize: [740, 23.5], close: [777.5, 23.5], button: 17, header: 46};

const el = (tag, cls, attrs = {}) => {
    const node = document.createElement(tag);
    if (cls)
        node.className = cls;
    for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, v);
    return node;
};

export function start(root, {meter, hint} = {}) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stage = el('div', 'try-desk');
    root.append(stage);

    // ---------- layout of the desktop (logical px) ----------
    let W = 1400, scale = 1;
    let win = {x: 300, y: 170, width: 800, height: 500};

    const glass = el('div', 'try-glass');
    const icons = el('div', 'try-icons');
    const label = el('div', 'try-label', {'aria-hidden': 'true'});
    const winEl = el('div', 'try-win');
    const winImg = el('img', '', {src: 'dock/files-window.webp', alt: 'The Files window', draggable: 'false', width: '800', height: '500'});
    const minBtn = el('button', 'try-winbtn', {type: 'button', 'aria-label': 'Minimize the Files window'});
    const closeBtn = el('button', 'try-winbtn', {type: 'button', 'aria-label': 'Close the Files window'});
    winEl.append(winImg, minBtn, closeBtn);
    const canvas = el('canvas', 'try-genie', {'aria-hidden': 'true'});
    stage.append(winEl, canvas, glass, icons, label);

    // ---------- the dock's items ----------
    const items = APPS.map(app => {
        const item = {...app, scale: 1, hop: 0, pressed: false, center: 0};
        if (app.separator) {
            item.node = el('div', 'try-sep', {'aria-hidden': 'true'});
        } else {
            item.node = el('button', 'try-item', {type: 'button', 'aria-label': app.name});
            item.img = el('img', '', {src: `dock/${app.id}.webp`, alt: '', draggable: 'false', width: '192', height: '192'});
            item.dot = el('i', 'try-dot');
            item.node.append(item.img, item.dot);
        }
        icons.append(item.node);
        return item;
    });
    const files = items[0];

    let m;  // metrics, as bar.js _setMetrics, for the icon size that fits
    const fitted = () => {
        const icons = items.filter(i => !i.separator).length;
        const separators = items.length - icons;
        const growth = (MAX_SCALE - 1) * REACH * 54 / 48 / 2;
        const perSize = icons * 54 / 48 + separators * 19 / 48 + 14 / 48 + growth;
        return Math.max(16, Math.min(ICON, Math.floor((W - 32) / perSize)));
    };
    const setMetrics = size => {
        const k = size / 48;
        m = {icon: size, gap: 6 * k, padX: 7 * k, padTop: 6 * k, padBottom: 10 * k, float: 6,
            radius: 19 * k * 1.25, dot: Math.max(3, 4 * k), sep: 13 * k, labelGap: 8 * k};
        m.slabHeight = m.padTop + m.icon + m.padBottom;
        m.slabTop = H - m.float - m.slabHeight;
        m.iconTop = m.slabTop + m.padTop;
        for (const item of items) {
            item.slot = item.separator ? m.sep : m.icon;
            if (item.separator) {
                item.node.style.width = `${m.sep}px`;
                item.node.style.height = `${Math.round(m.icon * 0.72)}px`;
                item.node.style.top = `${m.iconTop + m.icon * 0.14}px`;
            } else {
                item.node.style.width = item.node.style.height = `${m.icon}px`;
                item.node.style.top = `${m.iconTop}px`;
                // Drawn at the magnified size and scaled down, so icons stay sharp
                // at every size (the dock oversamples for the same reason).
                const big = m.icon * MAX_SCALE;
                item.img.style.width = item.img.style.height = `${big}px`;
                item.img.style.left = `${(m.icon - big) / 2}px`;
                item.img.style.top = `${m.icon - big}px`;
                item.dot.style.width = item.dot.style.height = `${m.dot}px`;
                item.dot.style.bottom = `${-(m.padBottom + m.dot) / 2}px`;
            }
        }
        stage.style.setProperty('--r', `${m.radius}px`);
    };

    // ---------- sizing to the page ----------
    const resize = () => {
        const width = root.getBoundingClientRect().width;
        const narrow = width < 640;
        const nextW = narrow ? 700 : 1400;
        if (nextW !== W || !m) {
            W = nextW;
            win = narrow ? {x: 70, y: 150, width: 560, height: 350} : {x: 300, y: 170, width: 800, height: 500};
            setMetrics(fitted());
        }
        scale = width / W;
        stage.style.width = `${W}px`;
        stage.style.transform = `scale(${scale})`;
        root.style.height = `${H * scale}px`;
        stage.style.setProperty('--desk-x', `${-(1400 - W) / 2}px`);
        const dense = width * (window.devicePixelRatio || 1) > 1100;
        stage.style.backgroundImage = `url(dock/desk-${dense ? 1800 : 960}.webp)`;
        placeWindow();
        sizeCanvas();
        cursor = null;
        layout();
    };

    // ---------- the frame loop (bar.js _frame) ----------
    let pointer = null;      // [x, y] in logical px, or null when away
    let cursor = null;
    let envelope = 0, velocity = 0, target = 0, hover = false;
    let raf = 0, last = 0;
    let extent = [0, 0];
    let labelFor = null;
    const work = {ms: 0, fps: 0, frames: 0, shown: 0};

    const wake = () => {
        if (!raf) {
            last = 0;
            raf = requestAnimationFrame(frame);
        }
    };

    const inside = (x, y) => {
        const rise = envelope > 0.05 || target ? m.icon * (MAX_SCALE - 1) : 0;
        return x >= extent[0] && x <= extent[1] && y >= m.slabTop - rise && y <= H;
    };

    function frame(now) {
        const t0 = performance.now();
        const dt = last ? Math.min((now - last) / 1000, MAX_DT) : 0;
        if (last && now > last)
            work.fps += (1000 / (now - last) - work.fps) * 0.1;
        last = now;
        raf = 0;

        if (pointer) {
            if (cursor === null)
                cursor = pointer[0];
            else
                cursor += (pointer[0] - cursor) * (1 - Math.exp(-dt / CURSOR_TAU));
        }
        hover = !!pointer && inside(pointer[0], pointer[1]);
        target = hover ? 1 : 0;
        if (reduce.matches) {
            envelope = target;
            velocity = 0;
        } else {
            velocity += (-2 * SPRING * velocity - SPRING * SPRING * (envelope - target)) * dt;
            envelope = Math.min(1.2, Math.max(0, envelope + velocity * dt));
        }

        const bouncing = stepBounces(now);
        const genie = stepGenie(now);
        layout();

        const still = target === 0 && Math.abs(envelope) < 0.002 && Math.abs(velocity) < 0.02;
        if (still) {
            envelope = velocity = 0;
            layout();
        }
        work.ms += (performance.now() - t0 - work.ms) * 0.1;
        work.frames++;
        if (!still || bouncing || genie || (pointer && hover))
            raf = requestAnimationFrame(frame);
        showMeter(!!raf);
    }

    // bar.js _layout: the magnified slots, anchored under the pointer.
    function layout() {
        const slots = items.map(item => item.slot + m.gap);
        const total = slots.reduce((a, b) => a + b, 0);
        const start = (W - total) / 2;
        const bounds = [start];
        for (const slot of slots)
            bounds.push(bounds[bounds.length - 1] + slot);
        const eff = envelope * (MAX_SCALE - 1);
        const width = REACH * (m.icon + m.gap);
        const c = cursor ?? 0;
        const scales = items.map((item, i) => {
            if (eff <= 0)
                return 1;
            const center = (bounds[i] + bounds[i + 1]) / 2;
            const theta = Math.min(Math.max((center - (c - width / 2)) / width * 2 * Math.PI, 0), 2 * Math.PI);
            return 1 + eff * (1 - Math.cos(theta)) / 2;
        });
        const grown = [start];
        for (let i = 0; i < items.length; i++)
            grown.push(grown[i] + slots[i] * scales[i]);
        const n = items.length;
        let shift = 0;
        if (eff > 0) {
            if (c <= bounds[0]) {
                shift = 0;
            } else if (c >= bounds[n]) {
                shift = bounds[n] - grown[n];
            } else {
                let i = 0;
                while (i < n - 1 && bounds[i + 1] < c)
                    i++;
                shift = c - (grown[i] + (c - bounds[i]) * scales[i]);
            }
        }
        for (let i = 0; i < n; i++) {
            const item = items[i];
            const center = grown[i] + slots[i] * scales[i] / 2 + shift;
            item.center = center;
            item.scale = scales[i];
            item.rest = {x: bounds[i] + m.gap / 2, y: m.iconTop, width: item.slot, height: m.icon};
            const x = (center - item.slot / 2).toFixed(2);
            if (item.separator) {
                item.node.style.transform = `translate3d(${x}px,0,0)`;
            } else {
                // Only the icon hops; its running dot stays on the glass (items.js).
                const lift = item.hop * m.icon * LAUNCH_HEIGHT;
                item.node.style.transform = `translate3d(${x}px,0,0)`;
                item.img.style.transform = `translate3d(0,${(-lift).toFixed(2)}px,0) scale(${(scales[i] / MAX_SCALE).toFixed(4)})`;
            }
        }
        const pad = m.padX - m.gap / 2;
        const left = grown[0] + shift - pad;
        const right = grown[n] + shift + pad;
        extent = [left, right];
        glass.style.transform = `translate3d(${left.toFixed(2)}px,${m.slabTop}px,0)`;
        glass.style.width = `${(right - left).toFixed(2)}px`;
        glass.style.height = `${m.slabHeight}px`;
        layoutLabel(grown, scales, slots, shift);
    }

    // The name of the app under the pointer, above its icon as magnified.
    function layoutLabel(grown, scales, slots, shift) {
        let index = -1;
        if (hover && cursor !== null) {
            for (let i = 0; i < items.length; i++) {
                if (cursor >= grown[i] + shift && cursor < grown[i + 1] + shift && items[i].name) {
                    index = i;
                    break;
                }
            }
        }
        if (index < 0 && focused >= 0)
            index = focused;
        if (index < 0) {
            if (labelFor) {
                labelFor = null;
                label.classList.remove('on');
            }
            return;
        }
        const item = items[index];
        if (labelFor !== item) {
            label.textContent = item.name;
            label.classList.add('on');
            labelFor = item;
        }
        const width = label.offsetWidth, height = label.offsetHeight;
        const center = grown[index] + slots[index] * scales[index] / 2 + shift;
        const iconTop = m.iconTop + m.icon - m.icon * scales[index] - item.hop * m.icon * LAUNCH_HEIGHT;
        const x = Math.min(Math.max(center - width / 2, 4), W - width - 4);
        label.style.transform = `translate3d(${Math.round(x)}px,${Math.round(iconTop - m.labelGap - height)}px,0)`;
    }

    // ---------- bounces (items.js bounce) ----------
    function bounce(item, hops, then) {
        if (item.bouncing)
            return;
        if (reduce.matches) {
            then?.();
            return;
        }
        item.bouncing = {start: performance.now(), hops, then};
        wake();
    }
    function stepBounces(now) {
        let any = false;
        for (const item of items) {
            const b = item.bouncing;
            if (!b)
                continue;
            const t = (now - b.start) / BOUNCE_MS;
            const hop = Math.floor(t / 2);
            if (hop >= b.hops) {
                item.hop = 0;
                item.bouncing = null;
                b.then?.();
                continue;
            }
            const u = t - hop * 2;
            item.hop = u < 1 ? easeOutQuad(u) : 1 - easeInQuad(u - 1);
            any = true;
        }
        return any;
    }

    // ---------- the window ----------
    let state = 'open';   // open | minimized | closed | busy
    function placeWindow() {
        winEl.style.transform = `translate3d(${win.x}px,${win.y}px,0)`;
        winEl.style.width = `${win.width}px`;
        winEl.style.height = `${win.height}px`;
        const k = win.width / WINDOW.width;
        for (const [btn, [cx, cy]] of [[minBtn, WINDOW.minimize], [closeBtn, WINDOW.close]]) {
            btn.style.left = `${(cx - WINDOW.button) * k}px`;
            btn.style.top = `${(cy - WINDOW.button) * k}px`;
            btn.style.width = btn.style.height = `${WINDOW.button * 2 * k}px`;
        }
    }
    function setRunning(item, running) {
        item.running = running;
        item.node.classList.toggle('running', running);
    }

    // ---------- the genie (genie.js), drawn with WebGL ----------
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: true});
    let prog, texture, buffers, genie = null;
    const mesh = (() => {
        const tex = [], index = [];
        for (let j = 0; j <= Y_TILES; j++)
            for (let i = 0; i <= X_TILES; i++)
                tex.push(i / X_TILES, j / Y_TILES);
        for (let j = 0; j < Y_TILES; j++) {
            for (let i = 0; i < X_TILES; i++) {
                const a = j * (X_TILES + 1) + i, b = a + 1, c = a + X_TILES + 1, d = c + 1;
                index.push(a, b, c, b, d, c);
            }
        }
        return {tex: new Float32Array(tex), index: new Uint16Array(index), pos: new Float32Array(tex.length)};
    })();
    if (gl) {
        const shader = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        };
        prog = gl.createProgram();
        gl.attachShader(prog, shader(gl.VERTEX_SHADER, `
attribute vec2 pos; attribute vec2 uv; uniform vec2 size; varying vec2 v;
void main() { v = uv; gl_Position = vec4(pos.x / size.x * 2.0 - 1.0, 1.0 - pos.y / size.y * 2.0, 0.0, 1.0); }`));
        gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, `
precision mediump float; uniform sampler2D tex; uniform float alpha; varying vec2 v;
void main() { gl_FragColor = texture2D(tex, v) * alpha; }`));
        gl.linkProgram(prog);
        buffers = {pos: gl.createBuffer(), uv: gl.createBuffer(), index: gl.createBuffer()};
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.tex, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
        const upload = () => {
            texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, winImg);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        };
        if (winImg.complete && winImg.naturalWidth)
            upload();
        else
            winImg.addEventListener('load', upload, {once: true});
    }
    function sizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${H}px`;
        canvas.width = Math.round(W * scale * dpr);
        canvas.height = Math.round(H * scale * dpr);
    }
    // Where the window's point (tx, ty) is at progress p (genie.js vfunc_deform_vertex).
    function deform(p, tx, ty, w, icon) {
        const bend = smooth(clamp01(p / 0.42));
        const pour = clamp01((p - 0.22) / 0.78);
        const fall = pour * pour;
        const top = w.y + (icon.y - w.y) * fall;
        const bottom = w.y + w.height + (icon.y + icon.height - w.y - w.height) * Math.min(1, fall * 1.4);
        const y = top + ty * Math.max(0, bottom - top);
        const span = icon.y - w.y;
        const f = span > 1 ? smooth(clamp01((y - w.y) / span)) : 1;
        const left = w.x + (icon.x - w.x) * f;
        const right = w.x + w.width + (icon.x + icon.width - w.x - w.width) * f;
        const l = w.x + (left - w.x) * bend;
        const r = w.x + w.width + (right - w.x - w.width) * bend;
        return [l + tx * (r - l), y];
    }
    function drawGenie(p) {
        if (!gl || !texture)
            return;
        const icon = files.rest;
        for (let k = 0; k < mesh.tex.length; k += 2) {
            const [x, y] = deform(p, mesh.tex[k], mesh.tex[k + 1], win, icon);
            mesh.pos[k] = x;
            mesh.pos[k + 1] = y;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform2f(gl.getUniformLocation(prog, 'size'), W, H);
        gl.uniform1f(gl.getUniformLocation(prog, 'alpha'), 1 - 0.6 * clamp01((p - 0.8) / 0.2));
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
        const posLoc = gl.getAttribLocation(prog, 'pos');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        const uvLoc = gl.getAttribLocation(prog, 'uv');
        gl.enableVertexAttribArray(uvLoc);
        gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_SHORT, 0);
    }
    function clearGenie() {
        if (gl) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    }
    function runGenie(minimizing, then) {
        if (reduce.matches || !gl || !texture) {
            then();
            return;
        }
        state = 'busy';
        winEl.classList.add('hidden');
        genie = {start: performance.now(), minimizing, then};
        wake();
    }
    function stepGenie(now) {
        if (!genie)
            return false;
        const duration = genie.minimizing ? MINIMIZE_MS : UNMINIMIZE_MS;
        const t = clamp01((now - genie.start) / duration);
        // EASE_IN_SINE going in, EASE_OUT_SINE coming out, as Clutter's.
        const p = genie.minimizing ? 1 - Math.cos(t * Math.PI / 2) : 1 - Math.sin(t * Math.PI / 2);
        drawGenie(p);
        if (t >= 1) {
            const g = genie;
            genie = null;
            clearGenie();
            g.then();
            return false;
        }
        return true;
    }

    const minimize = () => {
        if (state !== 'open')
            return;
        runGenie(true, () => {
            state = 'minimized';
            winEl.classList.add('hidden');
            say('Minimized into Files. Click the Files icon to bring it back.');
        });
    };
    const unminimize = () => {
        runGenie(false, () => {
            state = 'open';
            winEl.classList.remove('hidden');
            say('');
        });
    };
    const close = () => {
        if (state !== 'open')
            return;
        state = 'closed';
        winEl.classList.add('closing');
        setTimeout(() => {
            winEl.classList.add('hidden');
            winEl.classList.remove('closing');
        }, 180);
        setRunning(files, false);
        say('Closed. Click Files to open it again: it bounces until its window is up.');
    };
    const open = () => {
        state = 'busy';
        bounce(files, 2, () => {
            setRunning(files, true);
            winEl.classList.remove('hidden');
            winEl.classList.add('opening');
            requestAnimationFrame(() => requestAnimationFrame(() => winEl.classList.remove('opening')));
            state = 'open';
            say('');
        });
    };
    minBtn.addEventListener('click', minimize);
    closeBtn.addEventListener('click', close);

    // Drag the window by its header bar.
    let drag = null;
    winEl.addEventListener('pointerdown', e => {
        if (state !== 'open' || e.target.closest('button'))
            return;
        const [x, y] = toDesk(e);
        if (y - win.y > WINDOW.header * win.width / WINDOW.width)
            return;
        drag = {dx: x - win.x, dy: y - win.y};
        winEl.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    winEl.addEventListener('pointermove', e => {
        if (!drag)
            return;
        const [x, y] = toDesk(e);
        win.x = Math.min(Math.max(x - drag.dx, -win.width * 0.6), W - win.width * 0.4);
        win.y = Math.min(Math.max(y - drag.dy, 32), m.slabTop - 60);
        placeWindow();
    });
    const endDrag = () => { drag = null; };
    winEl.addEventListener('pointerup', endDrag);
    winEl.addEventListener('pointercancel', endDrag);

    // ---------- clicks on the dock ----------
    const activate = item => {
        if (item.separator)
            return;
        if (item === files) {
            if (state === 'minimized')
                unminimize();
            else if (state === 'closed')
                open();
            return;
        }
        if (item.tool) {
            bounce(item, 1);
            return;
        }
        if (!item.running) {
            // A launch bounces until the app's first window is up.
            bounce(item, 2 + (item.id.length % 2), () => {
                setRunning(item, true);
                say(`${item.name} is running (its dot). Only Files has a window in this demo.`);
            });
        }
    };

    // ---------- pointer and touch ----------
    const toDesk = e => {
        const r = root.getBoundingClientRect();
        return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
    };
    let press = null;
    const itemAt = x => items.findIndex(i => !i.separator && Math.abs(x - i.center) <= i.slot * i.scale / 2 + m.gap / 2);
    root.addEventListener('pointermove', e => {
        pointer = toDesk(e);
        if (press && Math.abs(pointer[0] - press.x) > 8)
            press.moved = true;
        wake();
    });
    root.addEventListener('pointerleave', () => {
        if (press)
            return;
        pointer = null;
        wake();
    });
    icons.addEventListener('pointerdown', e => {
        const [x, y] = toDesk(e);
        pointer = [x, y];
        const index = itemAt(x);
        press = {x, index, moved: false, type: e.pointerType};
        if (index >= 0)
            items[index].node.classList.add('pressed');
        if (e.pointerType !== 'mouse')
            (e.target.closest('.try-item') ?? icons).setPointerCapture(e.pointerId);
        wake();
    });
    const release = e => {
        if (!press)
            return;
        for (const item of items)
            item.node.classList.remove('pressed');
        const [x] = toDesk(e);
        const index = itemAt(x);
        if (!press.moved || press.type === 'mouse') {
            if (index >= 0 && index === press.index)
                activate(items[index]);
        } else if (index >= 0) {
            activate(items[index]);  // a finger lifted over an icon after sliding along the dock
        }
        if (press.type !== 'mouse')
            pointer = null;
        press = null;
        wake();
    };
    icons.addEventListener('pointerup', release);
    icons.addEventListener('pointercancel', () => {
        press = null;
        pointer = null;
        wake();
    });
    icons.addEventListener('click', e => {
        // Keyboard activation (Enter/Space on a focused icon).
        if (e.detail !== 0)
            return;
        const index = items.findIndex(i => i.node === e.target.closest('.try-item'));
        if (index >= 0)
            activate(items[index]);
    });
    icons.addEventListener('contextmenu', e => e.preventDefault());

    // Keyboard: a focused icon magnifies as if pointed at.
    let focused = -1;
    items.forEach((item, i) => {
        if (item.separator)
            return;
        item.node.addEventListener('focus', () => {
            if (!item.node.matches(':focus-visible'))
                return;
            focused = i;
            pointer = [item.center, m.iconTop + m.icon / 2];
            cursor = item.center;
            wake();
        });
        item.node.addEventListener('blur', () => {
            focused = -1;
            pointer = null;
            wake();
        });
    });

    // ---------- the readout ----------
    let meterAt = 0;
    function showMeter(running) {
        if (!meter)
            return;
        const now = performance.now();
        if (running && now - meterAt < 250)
            return;
        meterAt = now;
        meter.textContent = running
            ? `${Math.round(work.fps)} fps · ${work.ms.toFixed(2)} ms of work a frame`
            : 'Still: no frames, no work until something moves';
        meter.classList.toggle('live', running);
    }
    let sayTimer = 0;
    function say(text) {
        if (!hint)
            return;
        clearTimeout(sayTimer);
        hint.textContent = text || hint.dataset.idle;
    }

    setRunning(files, true);
    resize();
    new ResizeObserver(resize).observe(root);
    showMeter(false);
    root.classList.add('ready');
}
