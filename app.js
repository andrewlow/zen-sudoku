// --- CONFIGURATION & SETTINGS ---
const SETTINGS = {
    darkMode: false,
    highlightRelated: true,
    highlightMistakes: true,
    highlightIdentical: true,
    autoClearNotes: true,
    difficulty: 'easy' 
};

const diffMap = {
    'easy': 0.6,
    'medium': 0.45,
    'hard': 0.3
};

const STATE = {
    dateSeed: 0,
    dateStr: "",
    board: [],
    initial: [],
    solution: [],
    notes: {},
    selected: 0,
    notesMode: false
};

let STATS = {
    streak: 0,
    totalSolved: { easy: 0, medium: 0, hard: 0 },
    lastSolvedDate: null, // Format: YYYYMMDD
    history: [] // Optional: track dates of completion
};

// --- UTILITIES ---

/**
 * Creates a deterministic random number generator based on a seed.
 * Essential for ensuring every user gets the same "Daily" puzzle.
 */
function seededRandom(seed) {
    return function() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

function areRelated(i, j) {
    const rI = Math.floor(i/9), cI = i%9, rJ = Math.floor(j/9), cJ = j%9;
    if (rI === rJ || cI === cJ) return true;
    return Math.floor(rI/3) === Math.floor(rJ/3) && Math.floor(cI/3) === Math.floor(cJ/3);
}

// --- DATA PERSISTENCE ---

function saveGame() {
    const data = {
        dateSeed: STATE.dateSeed,
        board: STATE.board,
        notes: STATE.notes,
        settings: SETTINGS,
        stats: STATS
    };
    localStorage.setItem('zenSudoku_save', JSON.stringify(data));
}

function loadGame() {
    const saved = localStorage.getItem('zenSudoku_save');
    if (!saved) return;
    const data = JSON.parse(saved);
    
    if (data.settings) Object.assign(SETTINGS, data.settings);
    if (data.stats) STATS = data.stats;
    
    // Load board only if day matches
    if (data.dateSeed === STATE.dateSeed && data.board && data.board.length === 81) {
        STATE.board = data.board;
        STATE.notes = data.notes || {};
    }
}

// --- ENGINE ---

function initDailyBoard() {
    const now = new Date();
    // Unique seed for the day: YYYYMMDD
    STATE.dateSeed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    STATE.dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    loadGame(); 
    applySettingsToUI();

    const rng = seededRandom(STATE.dateSeed);
    
    // Generate a valid base solution using a pattern shift
    const base = [
        1,2,3,4,5,6,7,8,9, 4,5,6,7,8,9,1,2,3, 7,8,9,1,2,3,4,5,6,
        2,3,1,5,6,4,8,9,7, 5,6,4,8,9,7,2,3,1, 8,9,7,2,3,1,5,6,4,
        3,1,2,6,4,5,9,7,8, 6,4,5,9,7,8,3,1,2, 9,7,8,3,1,2,6,4,5
    ];

    // Shuffle digits deterministically based on the daily seed
    let digits = [1,2,3,4,5,6,7,8,9];
    for (let i = 8; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [digits[i], digits[j]] = [digits[j], digits[i]];
    }
    STATE.solution = base.map(n => digits[n-1]);
    
    // Apply Difficulty Mask
    const threshold = diffMap[SETTINGS.difficulty] || 0.5;
    STATE.initial = STATE.solution.map(v => rng() < threshold ? v : 0);
    
    // If no progress saved, start with the mask
    if (!STATE.board || STATE.board.length === 0) {
        STATE.board = [...STATE.initial];
    }
}

function applySettingsToUI() {
    document.body.className = SETTINGS.darkMode ? 'dark-mode' : 'light-mode';
    document.getElementById('toggle-dark').checked = SETTINGS.darkMode;
    document.getElementById('toggle-related').checked = SETTINGS.highlightRelated;
    document.getElementById('toggle-mistakes').checked = SETTINGS.highlightMistakes;
    document.getElementById('toggle-identical').checked = SETTINGS.highlightIdentical;
    document.getElementById('toggle-autoclear').checked = SETTINGS.autoClearNotes;
    document.getElementById('select-difficulty').value = SETTINGS.difficulty;
}

function renderGrid() {
    const grid = document.getElementById('sudoku-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Determine the value of the currently selected cell to highlight matches
    const selectedVal = STATE.board[STATE.selected] !== 0 ? STATE.board[STATE.selected] : STATE.initial[STATE.selected];

    for (let i = 0; i < 81; i++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        
        // Logical Highlights
        if (STATE.selected === i) cell.classList.add('selected');
        else if (SETTINGS.highlightRelated && areRelated(i, STATE.selected)) cell.classList.add('related');
        
        const cellVal = STATE.initial[i] || STATE.board[i];
        if (SETTINGS.highlightIdentical && selectedVal !== 0 && cellVal === selectedVal) {
            cell.classList.add('match');
        }

        // Content Rendering
        if (STATE.initial[i] !== 0) {
            cell.classList.add('fixed');
            cell.textContent = STATE.initial[i];
        } else if (STATE.board[i] !== 0) {
            cell.classList.add('user-val');
            if (SETTINGS.highlightMistakes && STATE.board[i] !== STATE.solution[i]) {
                cell.classList.add('error');
            }
            cell.textContent = STATE.board[i];
        } else if (STATE.notes[i] && STATE.notes[i].length > 0) {
            cell.innerHTML = `<div class="notes-grid">${[1,2,3,4,5,6,7,8,9].map(n => 
                `<span>${STATE.notes[i].includes(n) ? n : ''}</span>`).join('')}</div>`;
        }

        cell.onclick = () => { STATE.selected = i; renderGrid(); };
        grid.appendChild(cell);
    }
    updateNumpad();
}

function updateNumpad() {
    const counts = Array(10).fill(0);
    STATE.board.forEach((v, i) => { 
        const actual = STATE.initial[i] || v;
        if(actual === STATE.solution[i]) counts[actual]++; 
    });
    document.querySelectorAll('.numpad button').forEach((btn, idx) => {
        if (counts[idx + 1] >= 9) btn.classList.add('completed');
        else btn.classList.remove('completed');
    });
}

// Logic to update stats upon winning
function recordWin() {
    const today = STATE.dateSeed;
    
    // Increment total for current difficulty
    STATS.totalSolved[SETTINGS.difficulty]++;
    
    // Handle Streak
    if (STATS.lastSolvedDate) {
        const yesterday = getYesterdaySeed(today);
        if (STATS.lastSolvedDate === yesterday) {
            STATS.streak++;
        } else if (STATS.lastSolvedDate !== today) {
            STATS.streak = 1;
        }
    } else {
        STATS.streak = 1;
    }
    
    STATS.lastSolvedDate = today;
    saveGame();
    updateStatsUI();
}

function getYesterdaySeed(todaySeed) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function updateStatsUI() {
    const statsBody = document.getElementById('stats-body');
    if (!statsBody) return;

    // Safety check: if STATS wasn't loaded correctly, use defaults
    const streak = STATS.streak || 0;
    const easy = STATS.totalSolved?.easy || 0;
    const medium = STATS.totalSolved?.medium || 0;
    const hard = STATS.totalSolved?.hard || 0;
    const total = easy + medium + hard;

    statsBody.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <span class="stat-val">${streak}</span>
                <span class="stat-label">Day Streak</span>
            </div>
            <div class="stat-card">
                <span class="stat-val">${total}</span>
                <span class="stat-label">Total Zen</span>
            </div>
        </div>
        <div class="stats-breakdown">
            <div class="diff-stat"><span>Easy</span> <strong>${easy}</strong></div>
            <div class="diff-stat"><span>Medium</span> <strong>${medium}</strong></div>
            <div class="diff-stat"><span>Hard</span> <strong>${hard}</strong></div>
        </div>
    `;
}

function handleInput(num) {
    if (STATE.initial[STATE.selected] !== 0) return;

    if (STATE.notesMode && num !== 0) {
        if (!STATE.notes[STATE.selected]) STATE.notes[STATE.selected] = [];
        const idx = STATE.notes[STATE.selected].indexOf(num);
        if (idx > -1) STATE.notes[STATE.selected].splice(idx, 1);
        else { STATE.notes[STATE.selected].push(num); STATE.board[STATE.selected] = 0; }
    } else {
        const isCorrectDigit = (num === STATE.solution[STATE.selected]);
        STATE.board[STATE.selected] = (STATE.board[STATE.selected] === num) ? 0 : num;
        STATE.notes[STATE.selected] = [];

        // Auto-Clear logic for peers
        if (SETTINGS.autoClearNotes && num !== 0 && isCorrectDigit) {
            for (let i = 0; i < 81; i++) {
                if (areRelated(i, STATE.selected) && STATE.notes[i]) {
                    const noteIdx = STATE.notes[i].indexOf(num);
                    if (noteIdx > -1) STATE.notes[i].splice(noteIdx, 1);
                }
            }
        }
    }
    renderGrid();
    saveGame();
    
    // Win Condition
    if (STATE.board.every((v, i) => (STATE.initial[i] || v) === STATE.solution[i])) {
        recordWin(); // Call this new function
        setTimeout(() => document.getElementById('win-overlay').classList.remove('hidden'), 300);
    }
}

// --- INITIALIZATION ---

function initSettingsListeners() {
    const toggleMap = {
        'toggle-dark': 'darkMode',
        'toggle-related': 'highlightRelated',
        'toggle-mistakes': 'highlightMistakes',
        'toggle-identical': 'highlightIdentical',
        'toggle-autoclear': 'autoClearNotes'
    };

    Object.keys(toggleMap).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.onchange = (e) => {
            SETTINGS[toggleMap[id]] = e.target.checked;
            applySettingsToUI();
            saveGame();
            renderGrid();
        };
    });

    document.getElementById('select-difficulty').onchange = (e) => {
        SETTINGS.difficulty = e.target.value;
        STATE.board = []; // Clear progress
        STATE.notes = {};
        saveGame();
        location.reload(); 
    };
}

document.addEventListener('keydown', (e) => {
    if (e.key >= 1 && e.key <= 9) handleInput(parseInt(e.key));
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') handleInput(0);
    if (e.key === 'ArrowUp' && STATE.selected >= 9) STATE.selected -= 9;
    if (e.key === 'ArrowDown' && STATE.selected <= 71) STATE.selected += 9;
    if (e.key === 'ArrowLeft' && STATE.selected % 9 > 0) STATE.selected -= 1;
    if (e.key === 'ArrowRight' && STATE.selected % 9 < 8) STATE.selected += 1;
    renderGrid();
});

window.onload = () => {
    initDailyBoard();
    initSettingsListeners();
    document.getElementById('current-date-display').textContent = STATE.dateStr;

    // Build Numpad UI
    const pad = document.getElementById('number-pad');
    if (pad) {
        pad.innerHTML = '';
        for(let i=1; i<=9; i++) {
            const b = document.createElement('button');
            b.textContent = i;
            b.onclick = () => handleInput(i);
            pad.appendChild(b);
        }
    }

    // Controls
    document.getElementById('btn-notes').onclick = (e) => {
        STATE.notesMode = !STATE.notesMode;
        e.target.classList.toggle('active');
        e.target.textContent = STATE.notesMode ? 'Notes: On' : 'Notes: Off';
    };
    
    document.getElementById('btn-erase').onclick = () => handleInput(0);
    document.getElementById('btn-settings').onclick = () => document.getElementById('settings-overlay').classList.remove('hidden');
    document.getElementById('btn-stats').onclick = () => {
        updateStatsUI(); // 1. Generate the content first
        document.getElementById('stats-overlay').classList.remove('hidden'); // 2. Then show it
    };
    document.getElementById('btn-share').onclick = () => {
        const total = STATS.totalSolved.easy + STATS.totalSolved.medium + STATS.totalSolved.hard;
        const text = `🧘 Zen Sudoku\nStreak: ${STATS.streak} days\nTotal Puzzles: ${total}\nLevel: ${SETTINGS.difficulty.toUpperCase()}`;
    
        if (navigator.share) {
            navigator.share({ title: 'Zen Sudoku', text: text });
        } else {
            navigator.clipboard.writeText(text);
            alert('Stats copied to clipboard!');
        }
    };

    document.querySelectorAll('.close-overlay').forEach(b => b.onclick = () => b.closest('.overlay').classList.add('hidden'));

    renderGrid();
};
