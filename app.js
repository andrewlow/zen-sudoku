// --- CONFIGURATION & SETTINGS ---

const GENESIS_DATE = new Date(2026, 0, 1); // Jan 1, 2026
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0); // Normalize today for comparison

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

STATE.viewingDate = new Date(); // The date currently being viewed/played

let STATS = {
    streak: 0,
    totalSolved: { easy: 0, medium: 0, hard: 0 },
    lastSolvedDate: null, // Format: YYYYMMDD
    history: {}, // Optional: track dates of completion
    solvedCombos: [] // Explicitly define this here
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
    try {
        const snapshot = {
            dateSeed: Number(STATE.dateSeed),
            board: [...STATE.board],
            notes: JSON.parse(JSON.stringify(STATE.notes || {})),
            settings: { ...SETTINGS },
            stats: {
                streak: Number(STATS.streak) || 0,
                totalSolved: { ...STATS.totalSolved },
                lastSolvedDate: STATS.lastSolvedDate,
                history: { ...STATS.history }, // Force spread into object
                solvedCombos: [...(STATS.solvedCombos || [])]
            }
        };

        const stringified = JSON.stringify(snapshot);
        
        // SIZE GUARD: 5MB is the limit, let's alert if we pass 100KB
        if (stringified.length > 100000) {
            console.error("SAVE BLOCKED: Data is suspiciously large (" + (stringified.length/1024).toFixed(2) + " KB)");
            return;
        }

        localStorage.setItem('zenSudoku_save', stringified);
    } catch (e) {
        console.error("Save failed:", e);
    }
}

function loadGame() {
    const saved = localStorage.getItem('zenSudoku_save');
    if (!saved) return;
    const data = JSON.parse(saved);
    
    // Always load global settings and stats
    if (data.settings) Object.assign(SETTINGS, data.settings);
    if (data.stats) STATS = data.stats;
    
    // ONLY load the board and notes if the saved date matches the current STATE.dateSeed
    if (data.dateSeed === STATE.dateSeed && data.board && data.board.length === 81) {
        STATE.board = data.board;
        STATE.notes = data.notes || {};
    } else {
        // If the date is different, reset the active board state
        STATE.board = [];
        STATE.notes = {};
    }
}

// --- ENGINE ---

function initDailyBoard(targetDate = new Date()) {
    // 1. Safety Bounds
    if (targetDate < GENESIS_DATE) targetDate = new Date(GENESIS_DATE);
    if (targetDate > TODAY) targetDate = new Date(TODAY);

    // 2. Set the current session identity
    STATE.viewingDate = new Date(targetDate);
    STATE.dateSeed = targetDate.getFullYear() * 10000 + (targetDate.getMonth() + 1) * 100 + targetDate.getDate();
    
    // 3. THE CRITICAL WIPE
    // We clear these here so that if loadGame() doesn't find a match, 
    // no old data remains.
    STATE.board = [];
    STATE.notes = {};
    STATE.selected = 0;

    // 4. Update UI Header
    STATE.dateStr = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    document.getElementById('current-date-display').textContent = STATE.dateStr;

    // 5. Load progress (This will only fill STATE.board if the dateSeed matches)
    loadGame(); 

    // 6. Generate the Solution for the NEW date
const rng = seededRandom(STATE.dateSeed);
    
    // 6. Generate a Unique Solution Grid
    const base = [1,2,3,4,5,6,7,8,9,
                  4,5,6,7,8,9,1,2,3,
                  7,8,9,1,2,3,4,5,6,
                  2,3,1,5,6,4,8,9,7,
                  5,6,4,8,9,7,2,3,1,
                  8,9,7,2,3,1,5,6,4,
                  3,1,2,6,4,5,9,7,8,
                  6,4,5,9,7,8,3,1,2,
                  9,7,8,3,1,2,6,4,5];
    
    // Shuffle rows within blocks to randomize structure
    const rowOrder = [0,1,2,3,4,5,6,7,8];
    [0,3,6].forEach(start => {
        for (let i = 2; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [rowOrder[start+i], rowOrder[start+j]] = [rowOrder[start+j], rowOrder[start+i]];
        }
    });

    let digits = [1,2,3,4,5,6,7,8,9];
    for (let i = 8; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [digits[i], digits[j]] = [digits[j], digits[i]];
    }

    STATE.solution = [];
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            STATE.solution.push(digits[base[rowOrder[r] * 9 + c] - 1]);
        }
    }

    // 7. Initial Clue Deletion (Symmetric)
    const difficultyLevels = { 'easy': 38, 'medium': 30, 'hard': 25 };
    const cluesTarget = difficultyLevels[SETTINGS.difficulty] || 32;
    
    STATE.initial = [...STATE.solution];
    let indices = Array.from({length: 81}, (_, i) => i);
    // Shuffle indices for random removal
    for (let i = 80; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    let removed = 0;
    for (let idx of indices) {
        if (81 - removed <= cluesTarget) break;
        let opp = 80 - idx;
        if (STATE.initial[idx] !== 0) {
            let backupIdx = STATE.initial[idx];
            let backupOpp = STATE.initial[opp];
            
            STATE.initial[idx] = 0;
            STATE.initial[opp] = 0;
            
            // 8. UNQUENESS CHECK: If removing these creates > 1 solution, put them back
            if (countSolutions(STATE.initial) > 1) {
                STATE.initial[idx] = backupIdx;
                STATE.initial[opp] = backupOpp;
            } else {
                removed += (idx === opp) ? 1 : 2;
            }
        }
    }

    if (STATE.board.length === 0) STATE.board = [...STATE.initial];
    renderGrid();
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
    const puzzleDate = STATE.dateSeed;
    if (!STATS.history) STATS.history = {};

    const diffWeights = { 'easy': 1, 'medium': 2, 'hard': 3 };
    
    // CHANGE 1: Force currentDiff to be a string primitive
    const currentDiff = String(SETTINGS.difficulty); 
    const previousEntry = STATS.history[puzzleDate];
    
    // CHANGE 2: Robust weight check (handles if previousEntry was accidentally an object)
    const previousWeight = (typeof previousEntry === 'string') ? (diffWeights[previousEntry] || 0) : 0;
    const currentWeight = diffWeights[currentDiff] || 0;

    if (!previousEntry || currentWeight > previousWeight) {
        STATS.history[puzzleDate] = currentDiff;
    }
    
    // (Step 2: Totals)
    if (!STATS.solvedCombos) STATS.solvedCombos = [];
    const comboKey = `${puzzleDate}_${currentDiff}`;
    
    if (!STATS.solvedCombos.includes(comboKey)) {
        STATS.totalSolved[currentDiff]++;
        STATS.solvedCombos.push(comboKey);
    }
    
    // (Step 3: Streak Logic - Kept exactly as you had it)
    const realToday = new Date();
    const realTodaySeed = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

    if (puzzleDate === realTodaySeed) {
        if (STATS.lastSolvedDate) {
            const yesterday = getYesterdaySeed(realTodaySeed);
            if (STATS.lastSolvedDate === yesterday) {
                STATS.streak++;
            } else if (STATS.lastSolvedDate !== realTodaySeed) {
                STATS.streak = 1;
            }
        } else {
            STATS.streak = 1;
        }
        STATS.lastSolvedDate = realTodaySeed;
    }
    
    saveGame();
    updateStatsUI();
}

function renderCalendar() {
    const container = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('calendar-month-year');
    if (!container || !monthLabel) return;

    container.innerHTML = '';
    const year = STATE.viewingDate.getFullYear();
    const month = STATE.viewingDate.getMonth();
    
    monthLabel.textContent = STATE.viewingDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Boundary Logic for Buttons (Preserved)
    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');
    
    if (year === 2026 && month === 0) prevBtn.style.visibility = 'hidden';
    else prevBtn.style.visibility = 'visible';

    if (year === TODAY.getFullYear() && month === TODAY.getMonth()) nextBtn.style.visibility = 'hidden';
    else nextBtn.style.visibility = 'visible';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Spacers for the start of the month
    for (let i = 0; i < firstDay; i++) {
        container.appendChild(document.createElement('div'));
    }

    // Actual Today (Real world) for visual underlining
    const realToday = new Date();
    const realTodaySeed = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateSeed = year * 10000 + (month + 1) * 100 + day;
        
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;

        // 1. Boundary Checks (Genesis and Future)
        const isFuture = dateObj > TODAY;
        const isBeforeGenesis = dateObj < GENESIS_DATE;

        if (isFuture || isBeforeGenesis) {
            dayEl.classList.add('disabled');
            dayEl.style.opacity = "0.15";
            dayEl.style.cursor = "default";
        } else {
            // 2. Visual State: Completion (Reflecting history of older days)
            if (STATS.history && STATS.history[dateSeed]) {
                dayEl.classList.add('completed');
                // Optional: add difficulty class to color code rings (diff-easy, diff-hard)
                dayEl.classList.add(`diff-${STATS.history[dateSeed]}`);
            }

            // 3. Visual State: Active Day (What board is currently loaded)
            if (dateSeed === STATE.dateSeed) {
                dayEl.classList.add('active');
            }

            // 4. Visual State: Real-world Today
            if (dateSeed === realTodaySeed) {
                dayEl.classList.add('is-today');
            }
            if (STATS.history && STATS.history[dateSeed]) dayEl.classList.add('completed');
            if (dateSeed === STATE.dateSeed) dayEl.classList.add('active');

            // 5. Interaction: Time Travel
            dayEl.onclick = () => {
                initDailyBoard(dateObj);
                document.getElementById('stats-overlay').classList.add('hidden');
            };
        }
        
        container.appendChild(dayEl);
    }
}

function getYesterdaySeed(currentSeed) {
    // currentSeed is YYYYMMDD
    const y = Math.floor(currentSeed / 10000);
    const m = Math.floor((currentSeed % 10000) / 100) - 1;
    const d = currentSeed % 100;
    
    const date = new Date(y, m, d);
    date.setDate(date.getDate() - 1);
    
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
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

/**
 * Recursively counts solutions for a given board state.
 * @param {Array} board - The 81-item board array.
 * @param {number} limit - The number of solutions at which to stop searching.
 * @returns {number} - Number of solutions found (capped at limit).
 */
function countSolutions(board, limit = 2) {
    let count = 0;
    const b = [...board];

    function solve() {
        if (count >= limit) return;
        const empty = b.indexOf(0);
        if (empty === -1) { count++; return; }

        const r = Math.floor(empty / 9), c = empty % 9;
        const boxR = Math.floor(r / 3) * 3, boxC = Math.floor(c / 3) * 3;

        // Bitmask or simple array check for valid numbers
        const used = new Set();
        for (let i = 0; i < 9; i++) {
            used.add(b[r * 9 + i]);
            used.add(b[i * 9 + c]);
            used.add(b[(boxR + Math.floor(i / 3)) * 9 + (boxC + i % 3)]);
        }

        for (let num = 1; num <= 9; num++) {
            if (!used.has(num)) {
                b[empty] = num;
                solve();
                b[empty] = 0;
                if (count >= limit) return;
            }
        }
    }

    solve();
    return count;
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
        updateStatsUI(); // 1. Generate the stats content first
        renderCalendar(); // 2. Render calendar inside stats
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
    // Next/Prev Month Listeners
    document.getElementById('cal-prev').onclick = (e) => {
        e.stopPropagation();
        STATE.viewingDate.setMonth(STATE.viewingDate.getMonth() - 1);
        renderCalendar();
    };
    document.getElementById('cal-next').onclick = (e) => {
        e.stopPropagation();
        STATE.viewingDate.setMonth(STATE.viewingDate.getMonth() + 1);
        renderCalendar();
    };

    document.querySelectorAll('.close-overlay').forEach(b => b.onclick = () => b.closest('.overlay').classList.add('hidden'));

    renderGrid();
};
