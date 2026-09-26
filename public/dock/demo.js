// A live Jade Shell desktop, for jadeshell.app. The dock's numbers, curves and
// timings are its own: extension/lib/dock/bar.js (magnification), items.js
// (bounce) and genie.js (minimize), in the jade-shell repository. The desktop,
// windows, menus and lock screen are captures of the real Shell in each theme
// (desk.json says where everything is). Laid out in the desktop's logical
// pixels (1400×900; 700 wide on phones) and scaled to fit.

// ---------- the dock (bar.js, items.js, genie.js) ----------
const REACH = 6;             // slots the magnification spans
const SPRING = 20;           // rad/s: in and out in about a fifth of a second
const CURSOR_TAU = 0.045;    // s: smooths the pointer against the frame clock
const MAX_DT = 1 / 30;
const MAX_SCALE = 1.6;       // dock-magnification's default
const ICON = 48;             // dock-icon-size's default
const BOUNCE_MS = 330;       // one hop: up with gravity slowing it, down speeding it up
const LAUNCH_HEIGHT = 0.55;  // of an icon
const MINIMIZE_MS = 560;
const UNMINIMIZE_MS = 480;
const X_TILES = 6;
const Y_TILES = 48;
const H = 900;

const smooth = u => u * u * (3 - 2 * u);
const clamp01 = u => Math.min(1, Math.max(0, u));
const easeOutQuad = t => 1 - (1 - t) * (1 - t);
const easeInQuad = t => t * t;
const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
};

const APPS = [
    {id: 'files', name: 'Files', window: 'files'},
    {id: 'firefox', name: 'Firefox'},
    {id: 'terminal', name: 'Terminal', window: 'terminal'},
    {id: 'calendar', name: 'Calendar'},
    {id: 'editor', name: 'Text Editor', window: 'editor'},
    {id: 'vscode', name: 'Visual Studio Code'},
    {id: 'calculator', name: 'Calculator', window: 'calculator'},
    {id: 'weather', name: 'Weather'},
    {id: 'settings', name: 'Settings'},
    {separator: true},
    {id: 'apps', name: 'Show Apps', tool: true},
    {id: 'trash', name: 'Trash', tool: true},
];

// Where each window's minimize and close buttons are, from its right edge
// and top, in the window's own pixels (libadwaita's header bar; kitty's own).
const BUTTONS = {
    files: {min: [60, 23.5], close: [22.5, 23.5], r: 17, header: 46, title: 'Home'},
    editor: {min: [60, 23.5], close: [22.5, 23.5], r: 17, header: 46, title: 'Notes.md'},
    calculator: {min: [60, 23.5], close: [22.5, 23.5], r: 17, header: 46, title: 'Calculator'},
    terminal: {min: [59, 14], close: [11, 14], r: 11, header: 28, title: 'sh'},
};

const MENUS = ['dateMenu', 'jade-weather', 'jade-monitor', 'jade-usage', 'jade-network', 'jade-picker', 'jade-bell', 'quickSettings'];
const MENU_NAMES = {'dateMenu': 'Calendar', 'jade-weather': 'Weather', 'jade-monitor': 'System monitor', 'jade-usage': 'AI usage',
    'jade-network': 'Network', 'jade-picker': 'Theme picker', 'jade-bell': 'Notifications', 'quickSettings': 'Quick settings'};

const el = (tag, cls, attrs = {}) => {
    const node = document.createElement(tag);
    if (cls)
        node.className = cls;
    for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, v);
    return node;
};

export async function start(root, {meter, hint, chips, arrive = false} = {}) {
    const desk = await (await fetch('/dock/desk.json')).json();
    const THEMES = Object.keys(desk.themes);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let theme = THEMES.includes('osaka-jade') ? 'osaka-jade' : THEMES[0];
    let previousTheme = null;
    const T = () => desk.themes[theme];
    const asset = (name, id = theme) => `/dock/themes/${id}/${name}`;

    const stage = el('div', 'try-desk');
    root.append(stage);
    root.tabIndex = -1;

    // ---------- layers, back to front ----------
    const bgs = [el('div', 'try-bg front'), el('div', 'try-bg')];
    let bgFront = 0;
    const wsBar = el('div', 'try-wsbar');
    const spaces = el('div', 'try-spaces');
    const workspaces = [0, 1, 2, 3].map(() => el('div', 'try-space'));
    spaces.append(...workspaces);
    const canvas = el('canvas', 'try-genie', {'aria-hidden': 'true'});
    const glass = el('div', 'try-glass');
    const icons = el('div', 'try-icons');
    const label = el('div', 'try-label', {'aria-hidden': 'true'});
    const barHits = el('div', 'try-barhits');
    const menuLayer = el('div', 'try-menus');
    const overlay = el('div', 'try-overlay');   // Jade Menu, app grid, dock menus
    const night = el('div', 'try-night', {'aria-hidden': 'true'});
    const lockEl = el('div', 'try-lock', {'aria-hidden': 'true'});
    // The clocks: the shots leave their text out, and the page draws it live
    // where Jade Shell does, in its font and the theme's color.
    const clockEl = el('div', 'try-clock', {'aria-hidden': 'true'});
    const lockTime = el('div', 'try-clock', {'aria-hidden': 'true'});
    const lockDate = el('div', 'try-clock', {'aria-hidden': 'true'});
    lockEl.append(lockTime, lockDate);
    stage.append(...bgs, wsBar, spaces, canvas, glass, icons, label, menuLayer, clockEl, barHits, overlay, night, lockEl);

    let W = 1400, scale = 1, dx = 0;  // dx: where the 1400-wide desktop starts (phones show its middle)
    let m;  // the dock's metrics
    const dense = () => root.clientWidth * (window.devicePixelRatio || 1) > 960;  // the page's poster picks the same way

    // ---------- the dock's items ----------
    const items = APPS.map(app => {
        const item = {...app, scale: 1, hop: 0, running: false, center: 0};
        if (app.separator) {
            item.node = el('div', 'try-sep', {'aria-hidden': 'true'});
        } else {
            item.node = el('button', 'try-item', {type: 'button', 'aria-label': app.name});
            item.img = el('img', '', {src: app.id === 'files' ? asset('files.webp') : `/dock/${app.id}.webp`,
                alt: '', draggable: 'false', width: '192', height: '192'});
            item.dot = el('i', 'try-dot');
            item.node.append(item.img, item.dot);
        }
        icons.append(item.node);
        return item;
    });
    const itemFor = id => items.find(i => i.id === id);
    let dockShown = true, away = false;  // away: below the screen, waiting to rise

    const fitted = () => {
        const n = items.filter(i => !i.separator).length;
        const separators = items.length - n;
        const growth = (MAX_SCALE - 1) * REACH * 54 / 48 / 2;
        const perSize = n * 54 / 48 + separators * 19 / 48 + 14 / 48 + growth;
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

    // ---------- windows ----------
    const wins = {};
    for (const [id, [x, y, w, h]] of Object.entries(desk.windows)) {
        const b = BUTTONS[id];
        const app = APPS.find(a => a.window === id);
        const node = el('div', 'try-win hidden', {'data-win': id});
        const img = el('img', '', {alt: `The ${app.name} window`, draggable: 'false',  // its src: when it opens
            width: String(w), height: String(h)});
        const minBtn = el('button', 'try-winbtn', {type: 'button', 'aria-label': `Minimize ${b.title}`});
        const closeBtn = el('button', 'try-winbtn', {type: 'button', 'aria-label': `Close ${b.title}`});
        node.append(img, minBtn, closeBtn);
        const win = {id, node, img, minBtn, closeBtn, home: {x, y, w, h}, x, y, w, h, ws: 0, state: 'closed', z: 1, app};
        wins[id] = win;
        minBtn.addEventListener('click', () => minimize(win));
        closeBtn.addEventListener('click', () => close(win));
    }
    let zTop = 10, current = 0;
    const placeWindow = win => {
        const k = win.w / win.home.w;
        const b = BUTTONS[win.id];
        win.node.style.transform = `translate3d(${win.x}px,${win.y}px,0)`;
        win.node.style.width = `${win.w}px`;
        win.node.style.height = `${win.h}px`;
        win.node.style.zIndex = win.z;
        for (const [btn, [fromRight, cy]] of [[win.minBtn, b.min], [win.closeBtn, b.close]]) {
            btn.style.left = `${(win.home.w - fromRight - b.r) * k}px`;
            btn.style.top = `${(cy - b.r) * k}px`;
            btn.style.width = btn.style.height = `${b.r * 2 * k}px`;
        }
    };
    const raise = win => {
        win.z = ++zTop;
        win.node.style.zIndex = win.z;
    };
    const setRunning = (item, running) => {
        item.running = running;
        item.node.classList.toggle('running', running);
    };
    const homePlace = win => {
        const narrow = W < 1400;
        const k = narrow ? Math.min(1, (W - 60) / win.home.w) : 1;
        win.w = Math.round(win.home.w * k);
        win.h = Math.round(win.home.h * k);
        win.x = narrow ? Math.round((W - win.w) / 2) : win.home.x;
        win.y = narrow ? Math.max(44, Math.round(win.home.y * 0.8)) : win.home.y;
    };

    // ---------- sizing to the page ----------
    let measured = 0, cursor = null;
    const resize = () => {
        const width = root.clientWidth;
        if (!width)
            return;
        measured = width;
        const nextW = width < 640 ? 700 : 1400;
        if (nextW !== W || !m) {
            W = nextW;
            dx = (W - 1400) / 2;
            setMetrics(fitted());
            for (const win of Object.values(wins)) {
                homePlace(win);
                placeWindow(win);
            }
            buildBar();
            paintClocks();
            workspaces.forEach((space, k) => { space.style.transform = `translate3d(${(k - current) * W}px,0,0)`; });
        }
        scale = width / W;
        stage.style.width = `${W}px`;
        stage.style.transform = `scale(${scale})`;
        root.style.setProperty('--ar', `${W} / ${H}`);
        stage.style.setProperty('--desk-x', `${dx}px`);
        paintBackdrop(false);
        sizeCanvas();
        cursor = null;
        layout();
    };

    // ---------- the backdrop (desktop and top bar) and the theme's colors ----------
    function paintBackdrop(fade) {
        const url = `url(${asset(`desk-${dense() ? 1800 : 960}.webp`)})`;
        if (!fade) {
            bgs[bgFront].style.backgroundImage = url;
            return;
        }
        const back = 1 - bgFront;
        bgs[back].style.backgroundImage = url;
        bgs[back].classList.add('front');
        bgs[bgFront].classList.remove('front');
        bgFront = back;
    }
    function placeClock(node, style) {
        node.hidden = !style;
        if (!style)
            return;
        const [x, y, w, h] = style.box;
        const size = style.absolute ? style.size : style.size * 4 / 3;  // points at 96 dpi
        node.style.transform = `translate3d(${x + dx}px,${y}px,0)`;
        node.style.width = `${w}px`;
        node.style.height = `${h}px`;
        node.style.font = `${style.style ? 'italic ' : ''}${style.weight} ${size}px/${h}px "JetBrains Mono",monospace`;
        node.style.color = style.color;
    }
    function paintClocks() {
        const clock = T().clock ?? {};
        placeClock(clockEl, clock.bar);
        placeClock(lockTime, clock.time);
        placeClock(lockDate, clock.date);
    }
    function tick() {
        const d = new Date();
        const time = d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
        clockEl.textContent = `${d.toLocaleDateString(undefined, {weekday: 'long'})} ${time}`;
        lockTime.textContent = time;
        lockDate.textContent = d.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'}).replace(',', '');
        setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);  // on the minute
    }
    tick();

    function paintColors() {
        paintClocks();
        const t = T();
        const light = t.mode === 'light';
        const s = stage.style;
        s.setProperty('--tint', rgba(t.bg, light ? 0.42 : 0.38));
        s.setProperty('--edge', light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.12)');
        s.setProperty('--sheen', light ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.06)');
        s.setProperty('--shade', light ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.34)');
        s.setProperty('--dot', rgba(t.fg, light ? 0.75 : 0.9));
        s.setProperty('--sepc', rgba(t.fg, light ? 0.22 : 0.26));
        s.setProperty('--lbg', rgba(t.bg, 0.9));
        s.setProperty('--lfg', t.fg);
        s.setProperty('--lline', rgba(t.fg, 0.14));
        s.setProperty('--tfg', t.fg);
        s.setProperty('--tbg', t.bg);
        s.setProperty('--taccent', t.accent);
        s.setProperty('--trow', rgba(t.fg, 0.12));
        s.setProperty('--trowline', rgba(t.fg, 0.25));
        s.setProperty('--tctl', rgba(t.fg, 0.05));
        s.setProperty('--tdim', rgba(t.fg, 0.62));
        const w = t.ws;
        s.setProperty('--ws-bar', w.bar);
        s.setProperty('--ws-abg', w.activeBg);
        s.setProperty('--ws-afg', w.activeFg);
        s.setProperty('--ws-edge', w.activeEdge);
        s.setProperty('--ws-occ', w.occupied);
        s.setProperty('--ws-empty', w.empty);
        stage.classList.toggle('light', light);
    }

    // Preload what the new theme shows, then switch everything at once, as Jade
    // does; the desktop cross-fades in about a quarter of a second.
    const loaded = new Map();
    const preload = src => {
        if (!loaded.has(src)) {
            loaded.set(src, new Promise(resolve => {
                const im = new Image();
                im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(true));
                im.onerror = () => resolve(false);
                im.src = src;
            }));
        }
        return loaded.get(src);
    };
    let switching = null;
    async function switchTheme(id, {quiet} = {}) {
        if (!desk.themes[id] || id === theme)
            return;
        const token = switching = {};
        const needs = [asset(`desk-${dense() ? 1800 : 960}.webp`, id), asset('files.webp', id)];
        for (const win of Object.values(wins))
            if (win.state !== 'closed')
                needs.push(asset(`win-${win.id}.webp`, id));
        if (openMenu)
            needs.push(asset(`m-${openMenu}.webp`, id), asset(`b-${openMenu}.webp`, id));
        const arrived = await Promise.all(needs.map(preload));
        if (switching !== token)
            return;
        // A picture that didn't come (a dropped connection): stay whole on
        // the current theme rather than half-switched, and let a retry fetch it.
        if (!arrived.every(Boolean)) {
            needs.forEach((src, i) => arrived[i] || loaded.delete(src));
            say(`${desk.themes[id].name} didn't load. Check your connection and try again.`);
            chipsSync();
            return;
        }
        previousTheme = theme;
        theme = id;
        paintBackdrop(!reduce.matches);
        paintColors();
        itemFor('files').img.src = asset('files.webp');
        for (const win of Object.values(wins))
            if (win.state !== 'closed')
                win.img.src = asset(`win-${win.id}.webp`);
        if (openMenu)
            showMenu(openMenu);
        renderWorkspaces();
        chipsSync();
        if (overlayKind === 'grid')
            showAppGrid();
        if (!quiet)
            say(`${T().name}. The real thing switches in 253 ms.`);
        idle(warmTheme);
    }

    // ---------- the top bar ----------
    const wsButtons = [];
    const hits = {};
    function buildBar() {
        wsBar.replaceChildren();
        barHits.replaceChildren();
        wsButtons.length = 0;
        const [bx, by, bw, bh] = desk.bar['jade-workspaces'] ?? [0, 0, 108, 28];
        wsBar.style.transform = `translate3d(${bx + dx}px,${by}px,0)`;
        wsBar.style.width = `${bw}px`;
        wsBar.style.height = `${bh}px`;
        desk.workspaces.forEach(([x, y, w, h], i) => {
            const b = el('button', 'try-ws', {type: 'button', 'aria-label': `Workspace ${i + 1}`});
            b.textContent = String(i + 1);
            b.style.left = `${x - bx}px`;
            b.style.top = `${y - by}px`;
            b.style.width = `${w}px`;
            b.style.height = `${h}px`;
            b.addEventListener('click', () => switchWorkspace(i));
            wsBar.append(b);
            wsButtons.push(b);
        });
        for (const role of MENUS) {
            const box = desk.bar[role];
            if (!box || !T().menus[role])
                continue;
            const [x, y, w, h] = box;
            if (x + dx < 0 || x + dx + w > W)
                continue;  // off the phone's crop
            const b = el('button', 'try-hit', {type: 'button', 'aria-label': MENU_NAMES[role], 'aria-haspopup': 'true', 'aria-expanded': 'false'});
            b.style.transform = `translate3d(${x + dx}px,${y}px,0)`;
            b.style.width = `${w}px`;
            b.style.height = `${h}px`;
            b.addEventListener('click', e => {
                e.stopPropagation();
                // A click right after sliding onto the button (which opened
                // its menu) keeps it open instead of toggling it shut.
                if (openMenu === role && performance.now() - switchedAt > 350)
                    closeMenu();
                else
                    showMenu(role);
            });
            // GNOME: with a menu open, moving along the bar switches menus.
            b.addEventListener('pointerenter', () => {
                if (openMenu && openMenu !== role) {
                    showMenu(role);
                    switchedAt = performance.now();
                }
            });
            barHits.append(b);
            hits[role] = b;
        }
        renderWorkspaces();
    }
    function renderWorkspaces() {
        const occupied = new Set(Object.values(wins).filter(w => w.state !== 'closed').map(w => w.ws));
        wsButtons.forEach((b, i) => {
            b.classList.toggle('active', i === current);
            b.classList.toggle('occupied', occupied.has(i));
            b.setAttribute('aria-current', i === current ? 'true' : 'false');
        });
    }
    function switchWorkspace(i) {
        if (i === current || i < 0 || i > 3)
            return;
        closeMenu();
        current = i;
        spaces.classList.toggle('instant', reduce.matches);
        workspaces.forEach((space, k) => { space.style.transform = `translate3d(${(k - current) * W}px,0,0)`; });
        renderWorkspaces();
        say(i === 0 ? '' : `Workspace ${i + 1}. Back with 1.`);
    }

    // ---------- the menus ----------
    let openMenu = null, switchedAt = 0;
    const menuBtn = el('img', 'try-menubtn', {alt: '', draggable: 'false'});
    const menuImg = el('img', 'try-menu', {alt: '', draggable: 'false'});
    const menuHits = el('div', 'try-menuhits');
    menuLayer.append(menuBtn, menuImg, menuHits);
    function showMenu(role) {
        const box = T().menus[role];
        const button = desk.bar[role];
        if (!box || !button)
            return;
        closeOverlays();
        const fresh = !openMenu;
        openMenu = role;
        menuImg.src = asset(`m-${role}.webp`);
        menuImg.alt = `${MENU_NAMES[role]}, as it opens on Jade Shell`;
        menuImg.style.transform = `translate3d(${box[0] + dx}px,${box[1]}px,0)`;
        menuImg.style.width = `${box[2]}px`;
        menuImg.style.height = `${box[3]}px`;
        menuBtn.src = asset(`b-${role}.webp`);
        menuBtn.style.transform = `translate3d(${button[0] + dx}px,${button[1]}px,0)`;
        menuBtn.style.width = `${button[2]}px`;
        menuBtn.style.height = `${button[3]}px`;
        menuLayer.classList.add('open');
        if (fresh && !reduce.matches) {
            menuImg.classList.remove('pop');
            void menuImg.offsetWidth;
            menuImg.classList.add('pop');
        }
        Object.entries(hits).forEach(([r, b]) => b.setAttribute('aria-expanded', r === role ? 'true' : 'false'));
        buildMenuHits(role, box);
        if (role === 'jade-picker')
            say('Pick one. The picker stays open.');
    }
    function closeMenu() {
        if (!openMenu)
            return;
        openMenu = null;
        menuLayer.classList.remove('open');
        menuHits.replaceChildren();
        Object.values(hits).forEach(b => b.setAttribute('aria-expanded', 'false'));
    }
    // Inside a menu, the parts that do something here.
    function buildMenuHits(role, box) {
        menuHits.replaceChildren();
        if (role === 'jade-picker') {
            for (const [id, [x, y, w, h]] of Object.entries(desk.tiles)) {
                // Lumon stays in the picker, not on this page: its tile says so.
                const here = Boolean(desk.themes[id]);
                const b = el('button', 'try-tile', {type: 'button',
                    'aria-label': here ? `Switch to ${desk.themes[id].name}` : 'A theme on the real desktop only'});
                b.style.transform = `translate3d(${x + dx}px,${y}px,0)`;
                b.style.width = `${w}px`;
                b.style.height = `${h}px`;
                b.addEventListener('click', e => {
                    e.stopPropagation();
                    if (here)
                        switchTheme(id);
                    else
                        say('That one is on the real desktop only.');
                });
                menuHits.append(b);
            }
        }
        if (role === 'quickSettings') {
            const b = el('button', 'try-round', {type: 'button', 'aria-label': 'Lock the screen'});
            b.style.transform = `translate3d(${box[0] + 306.5 - 18 + dx}px,${box[1] + 34 - 18}px,0)`;
            b.addEventListener('click', e => { e.stopPropagation(); closeMenu(); lock(); });
            menuHits.append(b);
        }
    }

    // ---------- the lock screen ----------
    let locked = false;
    function lock() {
        closeOverlays();
        closeMenu();
        locked = true;
        lockEl.style.backgroundImage = `url(${asset(`lock-${dense() ? 1800 : 960}.webp`)})`;
        lockEl.classList.remove('leaving');
        lockEl.classList.add('on');
        say('Locked. Click to unlock.');
        root.focus({preventScroll: true});
    }
    function unlock() {
        if (!locked)
            return;
        locked = false;
        lockEl.classList.add('leaving');
        lockEl.classList.remove('on');
        say('');
    }
    lockEl.addEventListener('pointerdown', e => { e.stopPropagation(); unlock(); });

    // ---------- the frame loop (bar.js _frame) ----------
    let pointer = null, envelope = 0, velocity = 0, target = 0, hover = false;
    let raf = 0, last = 0, extent = [0, 0], labelFor = null, focused = -1;
    const work = {ms: 0, fps: 0};
    const wake = () => {
        if (!raf) {
            last = 0;
            raf = requestAnimationFrame(frame);
        }
    };
    const inside = (x, y) => {
        const rise = envelope > 0.05 || target ? m.icon * (MAX_SCALE - 1) : 0;
        return dockShown && !away && x >= extent[0] && x <= extent[1] && y >= m.slabTop - rise && y <= H;
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
        hover = !!pointer && inside(pointer[0], pointer[1]) && !locked && overlayKind !== 'jade' && overlayKind !== 'grid';
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

    // ---------- the genie (genie.js), drawn with WebGL ----------
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: true});
    let prog, texture, buffers, genie = null, loc = {};
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
        loc = {size: gl.getUniformLocation(prog, 'size'), alpha: gl.getUniformLocation(prog, 'alpha'),
            pos: gl.getAttribLocation(prog, 'pos'), uv: gl.getAttribLocation(prog, 'uv')};
        buffers = {pos: gl.createBuffer(), uv: gl.createBuffer(), index: gl.createBuffer()};
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.tex, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
        texture = gl.createTexture();
    }
    const upload = img => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
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
    function drawGenie(p, from, icon) {
        for (let k = 0; k < mesh.tex.length; k += 2) {
            const [x, y] = deform(p, mesh.tex[k], mesh.tex[k + 1], from, icon);
            mesh.pos[k] = x;
            mesh.pos[k + 1] = y;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform2f(loc.size, W, H);
        gl.uniform1f(loc.alpha, 1 - 0.6 * clamp01((p - 0.8) / 0.2));
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pos);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(loc.pos);
        gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
        gl.enableVertexAttribArray(loc.uv);
        gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_SHORT, 0);
    }
    const clearGenie = () => {
        if (gl) {
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    };
    function runGenie(win, minimizing, then) {
        if (reduce.matches || !gl || !win.img.complete || !win.img.naturalWidth || genie) {
            then();
            return;
        }
        upload(win.img);
        win.node.classList.add('hidden');
        genie = {start: performance.now(), minimizing, then,
            from: {x: win.x, y: win.y, width: win.w, height: win.h}, icon: itemFor(win.app.id).rest};
        wake();
    }
    function stepGenie(now) {
        if (!genie)
            return false;
        const duration = genie.minimizing ? MINIMIZE_MS : UNMINIMIZE_MS;
        const t = clamp01((now - genie.start) / duration);
        // EASE_IN_SINE going in, EASE_OUT_SINE coming out, as Clutter's.
        const p = genie.minimizing ? 1 - Math.cos(t * Math.PI / 2) : 1 - Math.sin(t * Math.PI / 2);
        drawGenie(p, genie.from, genie.icon);
        if (t >= 1) {
            const g = genie;
            genie = null;
            clearGenie();
            g.then();
            return false;
        }
        return true;
    }

    // ---------- what windows do ----------
    function minimize(win) {
        if (win.state !== 'open')
            return;
        win.state = 'busy';
        runGenie(win, true, () => {
            win.state = 'minimized';
            win.node.classList.add('hidden');
            renderWorkspaces();
            say('Click its icon to bring it back.');
        });
    }
    function unminimize(win) {
        win.state = 'busy';
        if (win.ws !== current)
            moveTo(win, current);
        raise(win);
        runGenie(win, false, () => {
            win.state = 'open';
            win.node.classList.remove('hidden');
            renderWorkspaces();
        });
    }
    function close(win) {
        if (win.state !== 'open')
            return;
        win.state = 'closed';
        win.node.classList.add('closing');
        setTimeout(() => {
            win.node.classList.add('hidden');
            win.node.classList.remove('closing');
        }, 180);
        setRunning(itemFor(win.app.id), false);
        renderWorkspaces();
    }
    function moveTo(win, ws) {
        win.ws = ws;
        workspaces[ws].append(win.node);
    }
    function open(win, {launch = true} = {}) {
        const item = itemFor(win.app.id);
        win.state = 'busy';
        const show = () => {
            moveTo(win, current);
            homePlace(win);
            placeWindow(win);
            raise(win);
            setRunning(item, true);
            win.node.classList.remove('hidden');
            win.node.classList.add('opening');
            requestAnimationFrame(() => requestAnimationFrame(() => win.node.classList.remove('opening')));
            win.state = 'open';
            renderWorkspaces();
        };
        // A launch bounces until the app's first window is up (items.js); the
        // window waits for its picture, so it never draws half-decoded.
        const ready = preload(asset(`win-${win.id}.webp`));
        win.img.src = asset(`win-${win.id}.webp`);
        if (launch)
            bounce(item, 2, () => ready.then(show));
        else
            ready.then(show);
    }
    for (const win of Object.values(wins)) {
        // Drag by the header bar; any click raises.
        let drag = null;
        win.node.addEventListener('pointerdown', e => {
            if (win.state !== 'open')
                return;
            raise(win);
            closeMenu();
            if (e.target.closest('button'))
                return;
            const [x, y] = toDesk(e);
            if (y - win.y > BUTTONS[win.id].header * win.w / win.home.w)
                return;
            drag = {dx: x - win.x, dy: y - win.y};
            win.node.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        win.node.addEventListener('pointermove', e => {
            if (!drag)
                return;
            const [x, y] = toDesk(e);
            win.x = Math.min(Math.max(x - drag.dx, -win.w * 0.6), W - win.w * 0.4);
            win.y = Math.min(Math.max(y - drag.dy, 30), m.slabTop - 60);
            placeWindow(win);
        });
        const end = () => { drag = null; };
        win.node.addEventListener('pointerup', end);
        win.node.addEventListener('pointercancel', end);
    }

    // ---------- clicks on the dock ----------
    function activate(item) {
        if (item.separator || locked)
            return;
        closeMenu();
        const win = item.window ? wins[item.window] : null;
        if (win) {
            if (win.state === 'minimized')
                unminimize(win);
            else if (win.state === 'closed')
                open(win);
            else if (win.state === 'open') {
                if (win.ws !== current)
                    switchWorkspace(win.ws);
                raise(win);
            }
            return;
        }
        if (item.id === 'apps') {
            showAppGrid();
            return;
        }
        if (item.id === 'trash') {
            bounce(item, 1);
            say('The trash is empty.');
            return;
        }
        if (!item.running) {
            bounce(item, 3, () => {
                setRunning(item, true);
                say(`${item.name} is running. Files, Terminal, Text Editor and Calculator open windows.`);
            });
        }
    }

    // ---------- pointer, touch and keys ----------
    const toDesk = e => {
        const r = root.getBoundingClientRect();
        return [(e.clientX - r.left - root.clientLeft) / scale, (e.clientY - r.top - root.clientTop) / scale];
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
        if (e.button === 2)
            return;
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
        if (index >= 0 && (index === press.index || (press.moved && press.type !== 'mouse')))
            activate(items[index]);
        if (press.type !== 'mouse')
            pointer = null;
        press = null;
        wake();
    };
    icons.addEventListener('pointerup', release);
    icons.addEventListener('pointercancel', () => { press = null; pointer = null; wake(); });
    icons.addEventListener('click', e => {
        if (e.detail !== 0)
            return;  // keyboard activation (Enter/Space) only
        const index = items.findIndex(i => i.node === e.target.closest('.try-item'));
        if (index >= 0)
            activate(items[index]);
    });
    icons.addEventListener('contextmenu', e => {
        e.preventDefault();
        const item = items.find(i => i.node === e.target.closest('.try-item'));
        if (item)
            showDockMenu(item);
    });
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
        item.node.addEventListener('blur', () => { focused = -1; pointer = null; wake(); });
    });
    // A click on the bare desktop closes menus.
    stage.addEventListener('pointerdown', e => {
        const t = e.target;
        if (t === stage || t.classList.contains('try-bg') || t.classList.contains('try-space') || t.classList.contains('try-spaces')) {
            closeMenu();
            closeOverlays();
        }
    });
    root.addEventListener('keydown', e => {
        if (locked) {
            e.preventDefault();
            unlock();
            return;
        }
        if (e.altKey && e.code === 'Space') {
            e.preventDefault();
            toggleJadeMenu();
            return;
        }
        if (e.key === 'Escape') {
            if (overlayKind || openMenu) {
                e.preventDefault();
                closeOverlays();
                closeMenu();
            }
            return;
        }
        if (e.ctrlKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            switchWorkspace(current + (e.key === 'ArrowRight' ? 1 : -1));
        }
    });

    // ---------- overlays: the Jade Menu, the app grid, dock menus ----------
    let overlayKind = null;
    function closeOverlays() {
        if (!overlayKind)
            return;
        overlayKind = null;
        overlay.replaceChildren();
        overlay.className = 'try-overlay';
        root.focus({preventScroll: true});
        wake();
    }
    overlay.addEventListener('pointerdown', e => {
        if (e.target === overlay || e.target.classList.contains('try-grid'))
            closeOverlays();
    });

    // The app grid (Show Apps): the dock's apps, big, over the dimmed desktop.
    function showAppGrid() {
        closeMenu();
        closeOverlays();
        overlayKind = 'grid';
        overlay.className = 'try-overlay dim grid';
        const grid = el('div', 'try-grid');
        for (const app of APPS.filter(a => !a.separator && !a.tool)) {
            const b = el('button', 'try-gridapp', {type: 'button'});
            const src = app.id === 'files' ? asset('files.webp') : `/dock/${app.id}.webp`;
            b.append(el('img', '', {src, alt: '', width: '96', height: '96', draggable: 'false'}));
            const span = el('span');
            span.textContent = app.name;
            b.append(span);
            b.addEventListener('click', () => { closeOverlays(); activate(itemFor(app.id)); });
            grid.append(b);
        }
        overlay.append(grid);
        grid.querySelector('button')?.focus({preventScroll: true});
        wake();
    }

    // A dock icon's menu (right-click): its window, New Window, Quit.
    function showDockMenu(item) {
        closeMenu();
        closeOverlays();
        overlayKind = 'dockmenu';
        overlay.className = 'try-overlay';
        const menu = el('div', 'try-ctx', {role: 'menu'});
        const add = (text, action, {disabled} = {}) => {
            const b = el('button', 'try-ctx-row', {type: 'button', role: 'menuitem'});
            b.textContent = text;
            b.disabled = !!disabled;
            b.addEventListener('click', () => { closeOverlays(); action?.(); });
            menu.append(b);
        };
        const sep = () => menu.append(el('div', 'try-ctx-sep'));
        const win = item.window ? wins[item.window] : null;
        if (win && (win.state === 'open' || win.state === 'minimized')) {
            add(BUTTONS[win.id].title, () => activate(item));
            sep();
        }
        if (!item.tool) {
            add('New Window', () => (win && win.state === 'closed' ? open(win) : activate(item)));
            sep();
            add('Unpin', null, {disabled: true});
            if (item.running) {
                add('Quit', () => {
                    if (win && win.state === 'minimized') {
                        win.state = 'closed';
                        renderWorkspaces();
                    } else if (win) {
                        close(win);
                    }
                    setRunning(item, false);
                });
            }
        } else if (item.id === 'apps') {
            add('Show Apps', () => showAppGrid());
            sep();
            add('Dock Settings…', () => say('Dock settings live in the Jade Shell app.'));
        } else {
            add('Open', () => activate(item));
            add('Empty Trash', null, {disabled: true});
        }
        overlay.append(menu);
        const r = item.rest;
        const x = Math.min(Math.max(r.x + r.width / 2 - 100, 8), W - 208);
        menu.style.left = `${x}px`;
        menu.style.bottom = `${H - m.slabTop + 10}px`;
        menu.querySelector('button:not([disabled])')?.focus({preventScroll: true});
    }

    // ---------- the Jade Menu (Super+Alt+Space; in the page, Alt+Space) ----------
    let iconData = null;
    const loadIcons = async () => (iconData ??= await (await fetch('/dock/icons.json')).json());
    const symbol = name => {
        const d = iconData?.[name];
        return d ? `<svg viewBox="${d[0]}" aria-hidden="true">${d[1]}</svg>` : '<svg viewBox="0 0 16 16" aria-hidden="true"></svg>';
    };
    const toggles = {awake: false, night: false, dnd: false, dark: true, dock: true, frosted: false, monitor: true, usage: true, bell: true};
    const soon = what => () => say(`${what} works on the real desktop.`);
    function tree() {
        const tg = (label, icon, key, apply) => ({label, icon, checked: () => toggles[key],
            action: () => { toggles[key] = !toggles[key]; apply?.(toggles[key]); }});
        return [
            {label: 'Apps', icon: 'view-app-grid', children: () => APPS.filter(a => !a.separator && !a.tool)
                .map(a => ({label: a.name, img: a.id === 'files' ? asset('files.webp') : `/dock/${a.id}.webp`, action: () => activate(itemFor(a.id))}))},
            {label: 'Clipboard History', icon: 'edit-paste', action: soon('Clipboard history')},
            {label: 'Capture', icon: 'camera-photo', children: () => [
                {label: 'Screenshot', icon: 'camera-photo', action: soon('The screenshot card')},
                {label: 'Screen Recording', icon: 'camera-web', action: soon('Screen recording')},
                {label: 'Color Picker', icon: 'color-select', action: soon('The color picker')},
                {label: 'Copy Text from Screen', icon: 'format-text-plaintext', action: soon('Copy text from screen')},
                {label: 'Read QR Code', icon: 'qr', action: soon('Reading QR codes')},
            ]},
            {label: 'Toggles', icon: 'emblem-system', children: () => [
                tg('Stay Awake', 'awake', 'awake'),
                tg('Night Light', 'night-light', 'night', on => stage.classList.toggle('nightlight', on)),
                tg('Do Not Disturb', 'notifications-disabled', 'dnd'),
                tg('Dark Style', 'weather-clear-night', 'dark'),
                tg('Dock', 'user-bookmarks', 'dock', on => { dockShown = on; stage.classList.toggle('nodock', !on); }),
                tg('Frosted Glass', 'weather-fog', 'frosted'),
                tg('System Monitor', 'cpu', 'monitor'),
                tg('AI Usage', 'ai-usage', 'usage'),
                tg('Notification Bell', 'bell', 'bell'),
            ]},
            {label: 'Style', icon: 'applications-graphics', children: () => [
                {label: 'Theme', icon: 'preferences-desktop-appearance', children: () => THEMES.map(id => ({label: desk.themes[id].name,
                    checked: () => id === theme, stay: true, action: () => switchTheme(id)}))},
                {label: 'Next Wallpaper', icon: 'preferences-desktop-wallpaper', action: soon('Next Wallpaper')},
                {label: 'Theme Picker', icon: 'view-grid', action: () => showMenu('jade-picker')},
                {label: 'Font', icon: 'preferences-desktop-font', action: soon('Choosing a font')},
                {label: 'Icons', icon: 'image-x-generic', action: soon('Choosing icons')},
            ]},
            {label: 'Setup', icon: 'preferences-system', children: () => [
                {label: 'Jade Shell Settings', icon: 'preferences-system', action: soon('The Jade Shell app')},
                {label: 'GNOME Settings', icon: 'preferences-system', action: () => activate(itemFor('settings'))},
                {label: 'Network', icon: 'network-wired', action: () => showMenu('jade-network')},
                {label: 'Speed Test', icon: 'network-transmit-receive', action: () => showMenu('jade-network')},
                {label: 'Keyboard Shortcuts', icon: 'input-keyboard', action: soon('The shortcut sheet (Super+K)')},
                {label: 'Check for Updates', icon: 'software-update-available', action: () => say('Jade Shell 0.9.0 is the latest version.')},
                {label: 'Undo the Last Theme Switch', icon: 'edit-undo', action: () => (previousTheme ? switchTheme(previousTheme) : say('Nothing to undo yet: switch a theme first.'))},
            ]},
            {label: 'Learn', icon: 'help-browser', children: () => [
                {label: 'Keyboard Shortcuts', icon: 'input-keyboard', action: soon('The shortcut sheet (Super+K)')},
                {label: 'Jade Shell Manual', icon: 'help-browser', action: () => window.open('https://github.com/parvezrob/jade-shell#readme', '_blank', 'noopener')},
            ]},
            {label: 'System', icon: 'system-shutdown', children: () => [
                {label: 'Lock', icon: 'system-lock-screen', action: () => lock()},
                {label: 'Suspend', icon: 'media-playback-pause', action: () => say('Suspend is for real computers, not browser tabs.')},
                {label: 'Log Out…', icon: 'system-log-out', action: () => say('Log out? You would miss the rest of the page.')},
                {label: 'Restart…', icon: 'system-reboot', action: () => say('Restart: not from a web page.')},
                {label: 'Power Off…', icon: 'system-shutdown', action: () => say('Power Off: not from a web page.')},
            ]},
        ];
    }
    async function toggleJadeMenu() {
        if (overlayKind === 'jade') {
            closeOverlays();
            return;
        }
        closeMenu();
        closeOverlays();
        await loadIcons();
        overlayKind = 'jade';
        overlay.className = 'try-overlay dim jade';
        const box = T().jadeMenu ?? [414, 247, 572, 405];
        const dialog = el('div', 'try-jm', {role: 'dialog', 'aria-label': 'Jade Menu'});
        dialog.style.left = `${box[0] + dx}px`;
        dialog.style.top = `${box[1]}px`;
        dialog.style.width = `${box[2]}px`;
        const title = el('div', 'try-jm-title');
        const search = el('input', 'try-jm-search', {type: 'search', placeholder: 'Search…', 'aria-label': 'Search the Jade Menu',
            autocomplete: 'off', spellcheck: 'false', id: 'try-jm-search'});
        const list = el('div', 'try-jm-rows', {role: 'listbox'});
        dialog.append(title, search, list);
        overlay.append(dialog);
        const stack = [{title: 'Jade Menu', entries: tree()}];
        let selected = 0, rows = [];
        const flatten = (entries, path = []) => entries.flatMap(e => e.children
            ? flatten(e.children(), [...path, e.label])
            : [{...e, path: [...path, e.label].join(' › ')}]);
        const render = () => {
            const q = search.value.trim().toLowerCase();
            const level = stack[stack.length - 1];
            title.textContent = q ? 'Search' : level.title;
            const entries = q ? flatten(stack[0].entries).filter(e => e.path.toLowerCase().includes(q)).slice(0, 8) : level.entries;
            list.replaceChildren();
            rows = entries.map((entry, i) => {
                const row = el('button', 'try-jm-row', {type: 'button', role: 'option'});
                const icon = entry.img ? `<img src="${entry.img}" alt="" width="18" height="18">` : symbol(entry.icon);
                const check = entry.checked ? `<b class="mark">${entry.checked() ? '✓' : ''}</b>` : '';
                const more = entry.children ? '<b class="more">›</b>' : '';
                row.innerHTML = `<i>${icon}</i><span></span>${check}${more}`;
                row.querySelector('span').textContent = q ? entry.path : entry.label;
                row.addEventListener('pointerenter', () => select(i));
                row.addEventListener('click', () => choose(i));
                list.append(row);
                return {row, entry};
            });
            select(Math.min(selected, Math.max(0, rows.length - 1)));
            if (!rows.length) {
                const none = el('div', 'try-jm-none');
                none.textContent = 'Nothing matches. Try “theme”, “lock” or “dock”.';
                list.append(none);
            }
        };
        const select = i => {
            selected = Math.max(0, i);
            rows.forEach((r, k) => r.row.classList.toggle('sel', k === selected));
        };
        const choose = i => {
            const r = rows[i];
            if (!r)
                return;
            if (r.entry.children) {
                stack.push({title: r.entry.label, entries: r.entry.children()});
                search.value = '';
                selected = 0;
                render();
                search.focus({preventScroll: true});
                return;
            }
            const keep = r.entry.checked;  // toggles and themes stay open, with their mark
            r.entry.action?.();
            if (keep && overlayKind === 'jade') {
                setTimeout(render, 30);
                search.focus({preventScroll: true});
            } else if (overlayKind === 'jade') {
                closeOverlays();
            }
        };
        search.addEventListener('input', () => { selected = 0; render(); });
        search.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); select((selected + 1) % Math.max(1, rows.length)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); select((selected - 1 + rows.length) % Math.max(1, rows.length)); }
            else if (e.key === 'Enter' || (e.key === 'ArrowRight' && rows[selected]?.entry.children)) { e.preventDefault(); choose(selected); }
            else if ((e.key === 'ArrowLeft' || (e.key === 'Backspace' && !search.value)) && stack.length > 1) {
                e.preventDefault();
                stack.pop();
                selected = 0;
                render();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeOverlays();
            }
        });
        render();
        search.focus({preventScroll: true});
        wake();
    }

    // ---------- the theme chips under the stage ----------
    const chipNodes = [];
    if (chips) {
        chips.replaceChildren();
        for (const id of THEMES) {
            const t = desk.themes[id];
            const b = el('button', 'try-chip', {type: 'button', 'aria-label': `Switch the desktop to ${t.name}`, title: t.name});
            b.style.background = t.bg;
            b.append(el('i', '', {style: `background:${t.accent}`}));
            b.addEventListener('click', () => switchTheme(id));
            chips.append(b);
            chipNodes.push([id, b]);
        }
    }
    function chipsSync() {
        for (const [id, b] of chipNodes)
            b.setAttribute('aria-pressed', id === theme ? 'true' : 'false');
    }

    // ---------- the readout ----------
    let meterAt = 0;
    function showMeter(running) {
        if (!meter)
            return;
        const now = performance.now();
        if (running && now - meterAt < 250)
            return;
        meterAt = now;
        meter.textContent = running ? `${Math.round(work.fps)} fps · ${work.ms.toFixed(2)} ms a frame` : '';
        meter.classList.toggle('live', running);
    }
    function say(text) {
        if (hint)
            hint.textContent = text || hint.dataset.idle;
    }
    window.jadeDesk = {openMenu: showMenu, jadeMenu: toggleJadeMenu, theme: id => switchTheme(id)};  // the page's buttons

    // ---------- start ----------
    const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, {timeout: 3000}) : setTimeout(fn, 1500));
    // This theme's pictures while idle, so menus and windows open at once.
    function warmTheme() {
        for (const role of MENUS)
            if (T().menus[role]) {
                preload(asset(`m-${role}.webp`));
                preload(asset(`b-${role}.webp`));
            }
        for (const id of Object.keys(wins))
            preload(asset(`win-${id}.webp`));
    }
    paintColors();
    for (const win of Object.values(wins))
        moveTo(win, 0);
    resize();
    chipsSync();
    new ResizeObserver(resize).observe(root);
    const check = () => { if (root.clientWidth !== measured) resize(); };
    window.addEventListener('resize', check, {passive: true});
    root.addEventListener('pointerenter', check);
    document.fonts?.ready.then(check);
    setTimeout(check, 400);
    setTimeout(check, 1500);
    showMeter(false);
    root.classList.add('ready');
    // The theme's menus and windows once someone is here to open them.
    let warmed = false;
    const warm = () => {
        if (!warmed) {
            warmed = true;
            idle(warmTheme);
        }
    };
    root.addEventListener('pointerenter', warm, {once: true});
    root.addEventListener('touchstart', warm, {once: true, passive: true});

    // ---------- arrival ----------
    // The first time the desktop's bottom edge is in view (or most of the
    // desktop has been, for a moment), the dock rises and Files launches from
    // it. Without motion (or asked not to), Files is open.
    const settle = () => {
        open(wins.files, {launch: false});
        say('');
    };
    if (!arrive || reduce.matches || !('IntersectionObserver' in window)) {
        settle();
        return;
    }
    away = true;
    stage.classList.add('dock-away');
    const sentinel = el('div', 'try-sentinel', {'aria-hidden': 'true'});
    root.append(sentinel);
    let risen = false;
    const rise = () => {
        if (risen)
            return;
        risen = true;
        io.disconnect();
        most.disconnect();
        clearTimeout(lingering);
        sentinel.remove();
        stage.classList.replace('dock-away', 'dock-rise');
        let done = false;
        const up = () => {
            if (done)
                return;
            done = true;
            away = false;
            stage.classList.remove('dock-rise');
            if (wins.files.state === 'closed') {
                open(wins.files);
                setTimeout(() => say('Now minimize it: the – button.'), BOUNCE_MS * 4);
            }
        };
        glass.addEventListener('animationend', up, {once: true});
        setTimeout(up, 1200);
    };
    // After the page's boot intro, and only while the tab is visible.
    const ready = () => !document.documentElement.classList.contains('boot') && document.visibilityState === 'visible';
    const whenReady = () => (ready() ? setTimeout(rise, 180) : setTimeout(whenReady, 150));
    const io = new IntersectionObserver(es => { if (es.some(e => e.intersectionRatio >= 0.6)) whenReady(); },
        {rootMargin: '0px 0px -24px 0px', threshold: 0.6});
    io.observe(sentinel);
    let lingering = 0;
    const most = new IntersectionObserver(es => {
        clearTimeout(lingering);
        if (es.some(e => e.intersectionRatio >= 0.6))
            lingering = setTimeout(whenReady, 1400);
    }, {threshold: 0.6});
    most.observe(root);
    root.addEventListener('pointerdown', rise, {once: true});
    root.addEventListener('keydown', rise, {once: true});
}
