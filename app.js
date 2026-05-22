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

const STORAGE_VERSION = "2.0";

let STATS = {
    version: STORAGE_VERSION,
    streak: 0,
    lastSolvedDate: null,
    totalSolved: { easy: 0, medium: 0, hard: 0 },
    solvedCombos: [], // Keep this to track unique completions
    history: {} 
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
        const dateKey = STATE.dateSeed;
        const diff = SETTINGS.difficulty;

        // 1. Update the in-memory STATS history for the current date/difficulty
        if (!STATS.history[dateKey]) STATS.history[dateKey] = {};

        // Calculate if current board is complete to determine "Lean" vs "Full" save
        const isActuallyComplete = STATE.board.every((v, i) => 
            (STATE.initial[i] || v) === STATE.solution[i] && (STATE.initial[i] || v) !== 0
        );

        if (isActuallyComplete) {
            // LEAN: Just mark completion. Solver can derive numbers from seed on reload.
            STATS.history[dateKey][diff] = { completed: true };
        } else {
            // FULL: Save progress for an ongoing game
            STATS.history[dateKey][diff] = {
                board: [...STATE.board],
                notes: JSON.parse(JSON.stringify(STATE.notes || {})),
                completed: false
            };
        }

        // 2. Build the Snapshot with Versioning
        const snapshot = {
            version: STORAGE_VERSION, // "2.0"
            dateSeed: Number(STATE.dateSeed), // Current active date
            settings: { ...SETTINGS },
            stats: {
                version: STORAGE_VERSION,
                streak: Number(STATS.streak) || 0,
                totalSolved: { ...STATS.totalSolved },
                lastSolvedDate: STATS.lastSolvedDate,
                solvedCombos: [...(STATS.solvedCombos || [])],
                history: { ...STATS.history }
            }
        };

        const stringified = JSON.stringify(snapshot);
        
        // 3. SIZE GUARD: 5MB is the browser limit
        if (stringified.length > 100000) {
            console.error("SAVE BLOCKED: Data is suspiciously large (" + (stringified.length/1024).toFixed(2) + " KB)");
            // We return here to prevent writing corrupted/looped data to disk
            return;
        }

        localStorage.setItem('zenSudoku_save', stringified);
        
    } catch (e) {
        console.error("Save failed. Checking for circular references or quota issues:", e);
    }
}

function loadGame() {
    const saved = localStorage.getItem('zenSudoku_save');
    if (!saved) return;
    
    const data = JSON.parse(saved);

    // 1. VERSION GUARD: If storage is old (v1.0), wipe it and start fresh with v2.0
    if (data.version !== STORAGE_VERSION) {
        console.warn("Storage version mismatch. Upgrading to " + STORAGE_VERSION);
        localStorage.removeItem('zenSudoku_save');
        return; 
    }

    // 2. RESTORE GLOBALS: Always load settings and stats
    if (data.settings) Object.assign(SETTINGS, data.settings);
    if (data.stats) {
        STATS = data.stats;
    }

    // 3. LOAD ACTIVE BOARD: Pull from the specific Date + Difficulty slot
    const dateKey = STATE.dateSeed;
    const diff = SETTINGS.difficulty;
    const savedSlot = STATS.history[dateKey]?.[diff];

    if (savedSlot) {
        if (savedSlot.completed) {
            // RECOVERY: The game was finished. 
            // Instead of storing 81 numbers, we just copy the solution.
            STATE.board = [...STATE.solution];
            STATE.notes = {};
        } else if (savedSlot.board && savedSlot.board.length === 81) {
            // PROGRESS: The game is mid-way. Load the saved numbers.
            STATE.board = [...savedSlot.board];
            STATE.notes = savedSlot.notes || {};
        }
    } else {
        // RESET: No saved progress for this specific difficulty on this date.
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

    // 5. Generate the Solution for the NEW date
    // We need the solution to exist so loadGame can "recover" it if needed
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
    // 8. Load progress (This will only fill STATE.board if the dateSeed matches)
    loadGame(); 

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
    const diffSelect = document.getElementById('select-difficulty');
    if (diffSelect) {
        diffSelect.value = SETTINGS.difficulty;
    }
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
    const dateKey = STATE.dateSeed;
    const diff = SETTINGS.difficulty;
    const comboKey = `${dateKey}_${diff}`;

    // 1. Initialize history slot if missing
    if (!STATS.history[dateKey]) STATS.history[dateKey] = {};
    if (!STATS.history[dateKey][diff]) STATS.history[dateKey][diff] = {};
    
    // 2. Mark as completed in history
    STATS.history[dateKey][diff].completed = true;

    // 3. Track Unique Totals using solvedCombos
    if (!STATS.solvedCombos.includes(comboKey)) {
        STATS.totalSolved[diff]++;
        STATS.solvedCombos.push(comboKey);
    }

    // 4. Streak Logic (Once per day solve)
    const realToday = new Date();
    const todaySeed = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

    if (dateKey === todaySeed) {
        if (STATS.lastSolvedDate !== todaySeed) {
            const yesterday = getYesterdaySeed(todaySeed);
            if (STATS.lastSolvedDate === yesterday) {
                STATS.streak++;
            } else {
                STATS.streak = 1;
            }
            STATS.lastSolvedDate = todaySeed;
        }
    }
    
    saveGame(); // This will now save the lean version (no board array)
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

    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');
    
    if (year === 2026 && month === 0) prevBtn.style.visibility = 'hidden';
    else prevBtn.style.visibility = 'visible';

    if (year === TODAY.getFullYear() && month === TODAY.getMonth()) nextBtn.style.visibility = 'hidden';
    else nextBtn.style.visibility = 'visible';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        container.appendChild(document.createElement('div'));
    }

    const realToday = new Date();
    const realTodaySeed = realToday.getFullYear() * 10000 + (realToday.getMonth() + 1) * 100 + realToday.getDate();

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateSeed = year * 10000 + (month + 1) * 100 + day;
        
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        dayEl.textContent = day;

        const isFuture = dateObj > TODAY;
        const isBeforeGenesis = dateObj < GENESIS_DATE;

        if (isFuture || isBeforeGenesis) {
            dayEl.classList.add('disabled');
            dayEl.style.opacity = "0.15";
            dayEl.style.cursor = "default";
        } else {
            // 1. Check history for THIS date
            const dayData = STATS.history ? STATS.history[dateSeed] : null;
            
            if (dayData) {
                // Count how many difficulty levels are marked 'completed'
                const levelsDone = Object.values(dayData).filter(slot => slot.completed).length;

                if (levelsDone > 0) {
                    dayEl.classList.add('completed');
                    // This allows CSS to show the 'X' or style based on completion count
                    dayEl.setAttribute('data-done-count', levelsDone);
                }
            }

            // 2. Visual State: Active Day (The day currently being played)
            if (dateSeed === STATE.dateSeed) {
                dayEl.classList.add('active');
            }

            // 3. Visual State: Real-world Today (The actual calendar date)
            if (dateSeed === realTodaySeed) {
                dayEl.classList.add('is-today');
            }

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
        const newDiff = e.target.value; // 'easy', 'medium', or 'hard'
    
        // 1. Update the global setting
        SETTINGS.difficulty = newDiff;
    
        // 2. Wipe the current active board so a new one generates at this difficulty
        STATE.board = []; 
        STATE.notes = {};
    
        // 3. Save the new difficulty and state
        saveGame();
    
        // 4. Re-initialize the board for the current date (no reload needed!)
        initDailyBoard(STATE.viewingDate);
    
        // 5. (Optional) Close the overlay so the user sees the new board
        document.getElementById('settings-overlay').classList.add('hidden');
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
    document.getElementById('btn-settings').onclick = () => {
        // SYNC: Update the dropdown to match the current setting before showing the UI
        document.getElementById('select-difficulty').value = SETTINGS.difficulty;
    
        document.getElementById('settings-overlay').classList.remove('hidden');
    };
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
