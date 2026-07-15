// Canonical Application File - Vanilla JS Student Application
import { BIOLOGY_CHAPTER_02 } from './questions.js';
window.BIOLOGY_CHAPTER_02 = BIOLOGY_CHAPTER_02;

// --- SAFE UNDERLINE RENDERER ---
function renderUnderlinedQuestion(rawQuestion, displayFixedSegments) {
  const cleanQuestion = rawQuestion.replace(/<\/?[a-z0-9]+(\s+[^>]*)?>/gi, '');
  
  if (!displayFixedSegments || displayFixedSegments.length === 0) {
    if (rawQuestion.includes('<u')) {
      return rawQuestion.replace(/<u[^>]*>(.*?)<\/u>/gi, '<span class="source-required-underline">$1</span>');
    }
    return escapeHtml(cleanQuestion);
  }

  let resultHtml = "";
  let currentIndex = 0;

  const segmentsWithIndex = displayFixedSegments.map(seg => {
    const idx = cleanQuestion.indexOf(seg);
    return { text: seg, index: idx };
  });

  segmentsWithIndex.sort((a, b) => a.index - b.index);

  for (const seg of segmentsWithIndex) {
    if (seg.index === -1) {
      throw new Error(`Segment "${seg.text}" not found in question text "${cleanQuestion}"`);
    }
  }

  for (const seg of segmentsWithIndex) {
    if (seg.index < currentIndex) {
      continue;
    }
    resultHtml += escapeHtml(cleanQuestion.substring(currentIndex, seg.index));
    resultHtml += `<span class="source-required-underline">${escapeHtml(seg.text)}</span>`;
    currentIndex = seg.index + seg.text.length;
  }

  resultHtml += escapeHtml(cleanQuestion.substring(currentIndex));
  return resultHtml;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const STORAGE_KEY = "school_biology_skeletal_system_v2";
const DB_NAME = "biology_drawings_db_ch02";
const STORE_NAME = "student_drawings_ch02";

// --- STATE MANAGEMENT ---
let appState = {
  answers: {},
  shownAnswers: {},
  ratings: {},
  mastery: {},
  fillAnswers: {},
  tfAnswers: {},
  mcqAnswers: {},
  drawingNotes: {}
};

let currentScreen = "home"; // "home" | "question" | "visuals" | "results"
let activeSection = "source"; // "source" | "enrichment"
let activeIdx = 0;
let currentFilter = "all"; // "all" | "unanswered" | "unrated" | "mastered" | "not_mastered"
let drawingImages = {}; // base64 images from IndexedDB
let lastScrollY = 0;
let showResetConfirm = false;

// Load progress from localStorage
function loadAppState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      appState = JSON.parse(saved);
      // Ensure all fields exist
      if (!appState.answers) appState.answers = {};
      if (!appState.shownAnswers) appState.shownAnswers = {};
      if (!appState.ratings) appState.ratings = {};
      if (!appState.mastery) appState.mastery = {};
      if (!appState.fillAnswers) appState.fillAnswers = {};
      if (!appState.tfAnswers) appState.tfAnswers = {};
      if (!appState.mcqAnswers) appState.mcqAnswers = {};
      if (!appState.drawingNotes) appState.drawingNotes = {};
    } catch (e) {
      console.error("Failed to load app state:", e);
    }
  }
}

// Save progress to localStorage
function saveAppState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

// --- INDEXEDDB FOR DRAWINGS ---
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDrawingImage(qId, base64) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(base64, qId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getDrawingImage(qId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(qId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDrawingImage(qId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(qId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadAllDrawings() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    drawingImages = {};
    return new Promise((resolve) => {
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          drawingImages[cursor.key] = cursor.value;
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => resolve();
    });
  } catch (e) {
    console.error("Failed to load drawings:", e);
  }
}

// --- CORE UTILITIES ---
function isQuestionAttempted(q) {
  if (q.questionType === "multi-part") {
    if (!q.subItems || q.subItems.length === 0) return false;
    return q.subItems.every(sub => isQuestionAttempted(sub));
  }
  if (q.questionType === "written" || q.questionType === "comparison" || q.questionType === "list") {
    return (appState.answers[q.id] || "").trim().length > 0;
  }
  if (q.questionType === "fill") {
    const answers = appState.fillAnswers[q.id] || [];
    if (answers.length === 0) return false;
    return answers.every(ans => (ans || "").trim().length > 0);
  }
  if (q.questionType === "mcq") {
    return appState.mcqAnswers[q.id] !== undefined && appState.mcqAnswers[q.id] !== null;
  }
  if (q.questionType === "true-false-correction" || q.questionType === "fixed-underlined-true-false") {
    const tfObj = appState.tfAnswers[q.id];
    if (!tfObj || tfObj.selected === null) return false;
    if (tfObj.selected === false) {
      return (tfObj.correction || "").trim().length > 0;
    }
    return true;
  }
  if (q.questionType === "drawing") {
    const hasImage = !!drawingImages[q.id];
    return hasImage;
  }
  return false;
}

// Get the list of questions based on active tab and filters
function getFilteredQuestions() {
  const list = activeSection === "source" 
    ? window.BIOLOGY_CHAPTER_02.sourceQuestions 
    : window.BIOLOGY_CHAPTER_02.enrichmentQuestions;
    
  return list.filter(q => {
    const isAttempted = isQuestionAttempted(q);
    const isRated = appState.ratings[q.id] !== undefined;
    const isMastered = appState.mastery[q.id] === "high";
    const isNotMastered = appState.mastery[q.id] === "low";

    if (currentFilter === "unanswered") return !isAttempted;
    if (currentFilter === "unrated") return !isRated;
    if (currentFilter === "mastered") return isMastered;
    if (currentFilter === "not_mastered") return isNotMastered;
    return true;
  });
}

// --- VIEWPORT PROTECTION ---
// Zero automatic scroll. Viewport stays absolute during all interactions.
function safeAction(callback) {
  return function(e) {
    if (e && e.preventDefault && e.target && e.target.type !== "textarea" && e.target.type !== "text" && e.target.type !== "file") {
      e.preventDefault();
    }
    callback.apply(this, arguments);
  };
}

// --- RENDERING ROUTINES ---
function renderApp() {
  const root = document.getElementById("app-container");
  if (!root) return;

  // Generate content
  let contentHtml = "";

  if (currentScreen === "home") {
    contentHtml = renderHomeScreen();
  } else if (currentScreen === "question") {
    contentHtml = renderQuestionScreen();
  } else if (currentScreen === "results") {
    contentHtml = renderResultsScreen();
  }

  let modalHtml = "";
  if (showResetConfirm) {
    modalHtml = `
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] transition-all animate-fade-in" id="reset-confirm-modal" dir="rtl">
        <div class="bg-white rounded-3xl p-6 md:p-8 max-w-sm w-full border border-borders shadow-2xl flex flex-col gap-5 text-right transform scale-100 transition-all">
          <div class="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 self-start">
            <i data-lucide="alert-triangle" class="w-6 h-6"></i>
          </div>
          <div class="flex flex-col gap-2">
            <h3 class="text-lg font-black text-main-text">إعادة تعيين كافة البيانات؟</h3>
            <p class="text-xs font-bold text-muted-text leading-relaxed">
              هل أنت متأكد من رغبتك في إعادة تعيين جميع المحاولات والدرجات والرسومات؟ لا يمكن التراجع عن هذا الإجراء وسيتم مسح كافة الإجابات.
            </p>
          </div>
          <div class="flex gap-3 mt-2">
            <button id="modal-confirm-reset-btn" class="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-extrabold text-sm rounded-xl transition-all cursor-pointer shadow-sm">
              نعم، متأكد
            </button>
            <button id="modal-cancel-reset-btn" class="flex-1 py-3 px-4 bg-white border border-borders hover:bg-page-bg/10 text-muted-text font-extrabold text-sm rounded-xl transition-all cursor-pointer shadow-sm">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    `;
  }

  const existingMain = root.querySelector("main");
  const existingHeader = root.querySelector("header");

  if (existingMain && existingHeader) {
    // Keep outer shell intact. Update only the main content container
    existingMain.innerHTML = contentHtml;

    // Update modal
    const existingModal = document.getElementById("reset-confirm-modal");
    if (existingModal) {
      if (showResetConfirm) {
        // modal is already there, leave it or update it
      } else {
        existingModal.remove();
      }
    } else if (showResetConfirm) {
      root.insertAdjacentHTML("beforeend", modalHtml);
    }

    // Update active button state in header
    const navHome = document.getElementById("nav-home");
    const navResults = document.getElementById("nav-results");

    if (navHome) navHome.className = `text-sm font-extrabold text-muted-text hover:text-primary-purple hover:bg-soft-lavender transition-all flex items-center gap-1.5 py-1.5 px-3 rounded-xl cursor-pointer ${currentScreen === "home" ? "bg-soft-lavender text-primary-purple" : ""}`;
    if (navResults) navResults.className = `text-sm font-extrabold text-muted-text hover:text-primary-purple hover:bg-soft-lavender transition-all flex items-center gap-1.5 py-1.5 px-3 rounded-xl cursor-pointer ${currentScreen === "results" ? "bg-soft-lavender text-primary-purple" : ""}`;

  } else {
    // Generate full page shell for initial render
    let navHtml = `
      <header class="bg-white border-b border-borders sticky top-0 z-50 py-3 px-4 md:px-8 shadow-sm">
        <div class="max-w-4xl mx-auto flex justify-between items-center w-full">
          <div class="flex items-center gap-2">
            <span class="text-xl font-black text-primary-purple tracking-tight select-none font-sans">تطبيق مدرسي</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="nav-home" class="text-sm font-extrabold text-muted-text hover:text-primary-purple hover:bg-soft-lavender transition-all flex items-center gap-1.5 py-1.5 px-3 rounded-xl cursor-pointer ${currentScreen === "home" ? "bg-soft-lavender text-primary-purple" : ""}">
              <i data-lucide="home" class="w-4.5 h-4.5"></i>
              <span>الرئيسية</span>
            </button>
            <button id="nav-results" class="text-sm font-extrabold text-muted-text hover:text-primary-purple hover:bg-soft-lavender transition-all flex items-center gap-1.5 py-1.5 px-3 rounded-xl cursor-pointer ${currentScreen === "results" ? "bg-soft-lavender text-primary-purple" : ""}">
              <i data-lucide="award" class="w-4.5 h-4.5"></i>
              <span>النتائج والتقرير</span>
            </button>
          </div>
        </div>
      </header>
    `;

    root.innerHTML = navHtml + `
      <main class="flex-grow w-full max-w-4xl mx-auto px-4 py-6 md:py-8 flex flex-col justify-start">
        ${contentHtml}
      </main>
    ` + modalHtml;
  }

  // Attach navbar triggers
  const navHomeBtn = document.getElementById("nav-home");
  const navResultsBtn = document.getElementById("nav-results");

  if (navHomeBtn) {
    navHomeBtn.onclick = safeAction(() => { currentScreen = "home"; renderApp(); });
  }
  if (navResultsBtn) {
    navResultsBtn.onclick = safeAction(() => { currentScreen = "results"; renderApp(); });
  }

  if (showResetConfirm) {
    const cancelBtn = document.getElementById("modal-cancel-reset-btn");
    const confirmBtn = document.getElementById("modal-confirm-reset-btn");
    if (cancelBtn) {
      cancelBtn.onclick = safeAction(() => {
        showResetConfirm = false;
        renderApp();
      });
    }
    if (confirmBtn) {
      confirmBtn.onclick = safeAction(async () => {
        localStorage.removeItem(STORAGE_KEY);
        appState = {
          answers: {},
          shownAnswers: {},
          ratings: {},
          mastery: {},
          fillAnswers: {},
          tfAnswers: {},
          mcqAnswers: {},
          drawingNotes: {}
        };
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        drawingImages = {};
        showResetConfirm = false;
        renderApp();
      });
    }
  }

  // Re-generate lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// --- HOME SCREEN ---
function renderHomeScreen() {
  const sourceLen = window.BIOLOGY_CHAPTER_02.sourceQuestions.length;
  const enrichmentLen = window.BIOLOGY_CHAPTER_02.enrichmentQuestions.length;
  
  const sourceAttempted = window.BIOLOGY_CHAPTER_02.sourceQuestions.filter(isQuestionAttempted).length;
  const enrichmentAttempted = window.BIOLOGY_CHAPTER_02.enrichmentQuestions.filter(isQuestionAttempted).length;

  const sourcePercent = Math.round((sourceAttempted / sourceLen) * 100);
  const enrichmentPercent = Math.round((enrichmentAttempted / enrichmentLen) * 100);

  setTimeout(() => {
    // Attach triggers for Home screen after DOM loads
    const btnSource = document.getElementById("open-source-btn");
    const btnEnrich = document.getElementById("open-enrichment-btn");
    const btnReset = document.getElementById("home-reset-btn");
    
    if (btnSource) btnSource.addEventListener("click", safeAction(() => {
      currentScreen = "question";
      activeSection = "source";
      activeIdx = 0;
      currentFilter = "all";
      renderApp();
    }));

    if (btnEnrich) btnEnrich.addEventListener("click", safeAction(() => {
      currentScreen = "question";
      activeSection = "enrichment";
      activeIdx = 0;
      currentFilter = "all";
      renderApp();
    }));

    if (btnReset) btnReset.addEventListener("click", safeAction(() => {
      showResetConfirm = true;
      renderApp();
    }));
  }, 50);

  return `
    <div class="flex flex-col gap-6 md:gap-8 max-w-3xl mx-auto w-full">
      <!-- Welcome Hero block -->
      <div class="bg-gradient-to-br from-primary-purple to-dark-purple text-white p-6 md:p-8 rounded-3xl shadow-md border border-borders/20 relative overflow-hidden">
        <div class="relative z-10 flex flex-col gap-3">
          <div class="inline-flex self-start bg-white/15 backdrop-blur-md text-white border border-white/20 rounded-full px-3 py-1 text-xs font-black">
            ${window.BIOLOGY_CHAPTER_02.meta.subject}
          </div>
          <h1 class="text-2xl md:text-3xl font-black tracking-tight leading-snug">
            ${window.BIOLOGY_CHAPTER_02.meta.chapterTitle}
          </h1>
          <p class="text-sm md:text-base text-soft-lavender/90 font-medium leading-relaxed max-w-xl">
            ${window.BIOLOGY_CHAPTER_02.meta.introduction}
          </p>
        </div>
        <div class="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-white/5 blur-3xl"></div>
      </div>

      <!-- Main Learning Paths -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
        <!-- Path 1: Source questions -->
        <div class="bg-white border border-borders p-6 rounded-3xl shadow-sm flex flex-col justify-between gap-5 relative group hover:border-primary-purple/40 transition-all">
          <div class="flex flex-col gap-3">
            <div class="w-12 h-12 rounded-2xl bg-soft-lavender flex items-center justify-center text-primary-purple">
              <i data-lucide="book-open" class="w-6 h-6"></i>
            </div>
            <h3 class="text-lg font-black text-main-text">الأسئلة المنهجية</h3>
            <p class="text-xs font-bold leading-relaxed text-muted-text">
              تضم هذه المجموعة 44 سؤالاً مأخوذة بشكل مباشر من الكتاب المدرسي لضمان التمكن التام من المنهج.
            </p>
          </div>
          
          <div class="flex flex-col gap-3">
            <!-- Progress strip -->
            <div class="flex justify-between items-center text-xs font-black">
              <span class="text-muted-text">إنجاز المحاولات</span>
              <span class="text-primary-purple">${sourceAttempted} من ${sourceLen} (${sourcePercent}%)</span>
            </div>
            <div class="w-full bg-page-bg rounded-full h-2.5 overflow-hidden">
              <div class="bg-primary-purple h-full rounded-full transition-all duration-500" style="width: ${sourcePercent}%"></div>
            </div>
            <button id="open-source-btn" class="w-full py-3 px-4 bg-primary-purple hover:bg-accent-purple text-white font-extrabold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer mt-2">
              <span>افتح الأسئلة المنهجية</span>
              <i data-lucide="arrow-left" class="w-4.5 h-4.5"></i>
            </button>
          </div>
        </div>

        <!-- Path 2: Enrichment questions -->
        <div class="bg-white border border-borders p-6 rounded-3xl shadow-sm flex flex-col justify-between gap-5 relative group hover:border-primary-purple/40 transition-all">
          <div class="flex flex-col gap-3">
            <div class="w-12 h-12 rounded-2xl bg-soft-lavender flex items-center justify-center text-primary-purple">
              <i data-lucide="sparkles" class="w-6 h-6"></i>
            </div>
            <h3 class="text-lg font-black text-main-text">الأسئلة الإثرائية</h3>
            <p class="text-xs font-bold leading-relaxed text-muted-text">
              تضم هذه المجموعة 44 سؤالاً إثرائياً تم صياغتها بعناية لاختبار المفاهيم وتوسيع الفهم العلمي للموضوع.
            </p>
          </div>
          
          <div class="flex flex-col gap-3">
            <!-- Progress strip -->
            <div class="flex justify-between items-center text-xs font-black">
              <span class="text-muted-text">إنجاز المحاولات</span>
              <span class="text-primary-purple">${enrichmentAttempted} من ${enrichmentLen} (${enrichmentPercent}%)</span>
            </div>
            <div class="w-full bg-page-bg rounded-full h-2.5 overflow-hidden">
              <div class="bg-primary-purple h-full rounded-full transition-all duration-500" style="width: ${enrichmentPercent}%"></div>
            </div>
            <button id="open-enrichment-btn" class="w-full py-3 px-4 bg-primary-purple hover:bg-accent-purple text-white font-extrabold text-sm rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer mt-2">
              <span>افتح الأسئلة الإثرائية</span>
              <i data-lucide="arrow-left" class="w-4.5 h-4.5"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Quick Reset block -->
      <div class="flex justify-end items-center mt-2">
        <button id="home-reset-btn" class="text-xs font-black text-red-600 hover:text-red-700 hover:bg-red-50 py-2.5 px-4 rounded-xl border border-red-200 transition-all flex items-center gap-1 cursor-pointer">
          <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
          <span>إعادة تعيين كافة البيانات</span>
        </button>
      </div>
    </div>
  `;
}

// --- QUESTIONS SCREEN ---
function renderQuestionScreen() {
  const filtered = getFilteredQuestions();
  const totalInFilter = filtered.length;

  // Safeguard bounds
  if (activeIdx >= totalInFilter) {
    activeIdx = Math.max(0, totalInFilter - 1);
  }

  const question = filtered[activeIdx];

  // Head section with tabs and filter options
  let sidebarHtml = `
    <div class="flex flex-col gap-4 border-b border-borders pb-4">
      <!-- Section Tab Toggle -->
      <div class="flex gap-2 bg-white p-1 rounded-2xl border border-borders w-full max-w-md mx-auto">
        <button id="tab-source" class="flex-grow py-2.5 rounded-xl text-sm font-black transition-all cursor-pointer ${activeSection === "source" ? "bg-primary-purple text-white shadow-sm" : "text-muted-text hover:text-primary-purple"}">الأسئلة المنهجية</button>
        <button id="tab-enrich" class="flex-grow py-2.5 rounded-xl text-sm font-black transition-all cursor-pointer ${activeSection === "enrichment" ? "bg-primary-purple text-white shadow-sm" : "text-muted-text hover:text-primary-purple"}">الأسئلة الإثرائية</button>
      </div>

      <!-- Filter Controls -->
      <div class="flex flex-wrap gap-2 justify-center">
        <button data-f="all" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border transition-all cursor-pointer ${currentFilter === "all" ? "bg-primary-purple border-primary-purple text-white" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">الكل</button>
        <button data-f="unanswered" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border transition-all cursor-pointer ${currentFilter === "unanswered" ? "bg-primary-purple border-primary-purple text-white" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">غير مجاب</button>
        <button data-f="unrated" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border transition-all cursor-pointer ${currentFilter === "unrated" ? "bg-primary-purple border-primary-purple text-white" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">غير مقيم</button>
        <button data-f="mastered" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border transition-all cursor-pointer ${currentFilter === "mastered" ? "bg-primary-purple border-primary-purple text-white" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">تم إتقانها</button>
        <button data-f="not_mastered" class="filter-btn text-xs font-black py-1.5 px-3.5 rounded-full border transition-all cursor-pointer ${currentFilter === "not_mastered" ? "bg-primary-purple border-primary-purple text-white" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">لم تتقن</button>
      </div>
    </div>
  `;

  // Jump lists pagination (1 to 44)
  const fullList = activeSection === "source" 
    ? window.BIOLOGY_CHAPTER_02.sourceQuestions 
    : window.BIOLOGY_CHAPTER_02.enrichmentQuestions;

  let paginationHtml = `
    <div class="flex flex-col gap-2 mt-4">
      <div class="text-xs font-black text-muted-text flex justify-between">
        <span>قائمة الأسئلة (اضغط للقفز السريع):</span>
        <span>السؤال ${activeIdx + 1} من ${totalInFilter}</span>
      </div>
      <div class="flex gap-1.5 overflow-x-auto pb-2 no-scrollbar w-full flex-wrap justify-center">
  `;

  fullList.forEach((q, idx) => {
    // Check index of this question in filtered list
    const filteredIdx = filtered.findIndex(fq => fq.id === q.id);
    const inFilter = filteredIdx !== -1;
    const isCurrent = inFilter && (filteredIdx === activeIdx);
    const attempted = isQuestionAttempted(q);
    const rated = appState.ratings[q.id] !== undefined;

    let btnClass = "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold transition-all border cursor-pointer select-none ";
    if (isCurrent) {
      btnClass += "bg-primary-purple border-primary-purple text-white shadow-sm scale-105";
    } else if (!inFilter) {
      btnClass += "bg-gray-100 border-gray-200 text-gray-300 pointer-events-none opacity-40";
    } else {
      if (rated) {
        btnClass += "bg-green-50 border-green-200 text-green-700 hover:border-primary-purple";
      } else if (attempted) {
        btnClass += "bg-amber-50 border-amber-200 text-amber-700 hover:border-primary-purple";
      } else {
        btnClass += "bg-white border-borders text-muted-text hover:border-primary-purple";
      }
    }

    paginationHtml += `
      <button data-idx="${filteredIdx}" class="jump-btn ${btnClass}">${q.num}</button>
    `;
  });

  paginationHtml += `
      </div>
    </div>
  `;

  if (!question) {
    return `
      <div class="flex flex-col gap-4">
        ${sidebarHtml}
        <div class="bg-white border border-borders rounded-3xl p-8 text-center flex flex-col items-center justify-center gap-4 mt-6">
          <div class="w-16 h-16 rounded-full bg-soft-lavender flex items-center justify-center text-primary-purple">
            <i data-lucide="alert-circle" class="w-8 h-8"></i>
          </div>
          <p class="text-base font-black text-muted-text">لا توجد أسئلة تطابق الفلتر المختار في هذا القسم.</p>
          <button id="reset-filter-btn" class="py-2.5 px-5 bg-primary-purple text-white text-sm font-extrabold rounded-xl transition-all cursor-pointer">عرض الكل</button>
        </div>
      </div>
    `;
  }

  // Question body card
  const isAttempted = isQuestionAttempted(question);
  const isShown = question.questionType !== "drawing" && !!appState.shownAnswers[question.id];

  let inputAreaHtml = "";

  if (question.questionType === "multi-part") {
    let subItemsHtml = "";
    (question.subItems || []).forEach((sub, sIdx) => {
      let subInputArea = "";
      if (sub.questionType === "written") {
        const val = appState.answers[sub.id] || "";
        subInputArea = `
          <div class="flex flex-col gap-1">
            <textarea data-sub-id="${sub.id}" rows="3" placeholder="اكتب إجابتك هنا..." class="sub-written-input w-full p-3 rounded-xl border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm leading-relaxed" ${isShown ? "disabled" : ""}>${val}</textarea>
          </div>
        `;
      } else if (sub.questionType === "mcq") {
        const selectedIdx = appState.mcqAnswers[sub.id];
        let optionsHtml = "";
        (sub.options || []).forEach((opt, i) => {
          const isSelected = selectedIdx === i;
          optionsHtml += `
            <button data-sub-id="${sub.id}" data-opt-idx="${i}" class="sub-mcq-option-btn text-right p-3 rounded-xl border transition-all text-xs font-extrabold cursor-pointer ${isSelected ? "bg-primary-purple border-primary-purple text-white shadow-sm scale-[1.02]" : "bg-white border-borders text-muted-text hover:border-primary-purple hover:bg-page-bg/10"}" ${isShown ? "disabled" : ""}>
              ${opt}
            </button>
          `;
        });
        subInputArea = `
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            ${optionsHtml}
          </div>
        `;
      }

      let subModelAnswerHtml = "";
      if (isShown) {
        subModelAnswerHtml = `
          <div class="bg-green-50/70 border border-green-200 rounded-xl p-3.5 mt-3 flex flex-col gap-1 text-right">
            <span class="text-xs font-black text-green-700">الجواب النموذجي للمطلب (${sIdx + 1}):</span>
            <p class="text-xs font-bold text-main-text leading-relaxed whitespace-pre-wrap">${sub.modelAnswer}</p>
          </div>
        `;
      }

      subItemsHtml += `
        <div class="border border-borders/80 bg-page-bg/10 rounded-2xl p-4 md:p-5 flex flex-col gap-3">
          <h3 class="text-sm font-black text-main-text leading-relaxed">${sub.question}</h3>
          ${subInputArea}
          ${subModelAnswerHtml}
        </div>
      `;
    });

    inputAreaHtml = `
      <div class="flex flex-col gap-4">
        <span class="text-xs font-black text-muted-text">أجب عن كل مطلب مستقل أدناه:</span>
        <div class="flex flex-col gap-4">
          ${subItemsHtml}
        </div>
      </div>
    `;
  } else if (question.questionType === "written" || question.questionType === "comparison" || question.questionType === "list") {
    const val = appState.answers[question.id] || "";
    inputAreaHtml = `
      <div class="flex flex-col gap-2">
        <label class="text-xs font-black text-muted-text">أدخل إجابتك بالتفصيل أدناه:</label>
        <textarea id="written-input" rows="4" placeholder="اكتب محاولتك هنا..." class="w-full p-3 rounded-xl border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm leading-relaxed" ${isShown ? "disabled" : ""}>${val}</textarea>
      </div>
    `;
  } else if (question.questionType === "fill") {
    // Fill in the blanks question
    const totalBlanks = question.blanks ? question.blanks.length : 1;
    const currentBlanks = appState.fillAnswers[question.id] || Array(totalBlanks).fill("");
    
    // We split the question by underscores or create separate text boxes.
    // Let's render separate distinct text boxes for each blank.
    let blanksFields = "";
    for (let i = 0; i < totalBlanks; i++) {
      blanksFields += `
        <div class="flex items-center gap-2">
          <span class="text-xs font-black text-muted-text">الفراغ (${i + 1}):</span>
          <input type="text" data-blank-idx="${i}" value="${currentBlanks[i] || ""}" placeholder="اكتب الكلمة المناسبة هنا..." class="blank-input flex-grow p-2.5 rounded-lg border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm" ${isShown ? "disabled" : ""}>
        </div>
      `;
    }
    inputAreaHtml = `
      <div class="flex flex-col gap-3">
        <div class="bg-page-bg/40 p-4 rounded-xl border border-borders/40 text-sm font-serif leading-relaxed text-main-text">
          ${question.question}
        </div>
        <div class="flex flex-col gap-2">
          ${blanksFields}
        </div>
      </div>
    `;
  } else if (question.questionType === "mcq") {
    const selectedIdx = appState.mcqAnswers[question.id];
    let optionsHtml = "";
    (question.options || []).forEach((opt, i) => {
      const isSelected = selectedIdx === i;
      optionsHtml += `
        <button data-opt-idx="${i}" class="mcq-option-btn text-right p-3 rounded-xl border transition-all text-sm font-bold cursor-pointer ${isSelected ? "bg-primary-purple border-primary-purple text-white shadow-sm" : "bg-white border-borders text-muted-text hover:border-primary-purple hover:bg-page-bg/10"}" ${isShown ? "disabled" : ""}>
          ${opt}
        </button>
      `;
    });
    inputAreaHtml = `
      <div class="flex flex-col gap-2">
        <span class="text-xs font-black text-muted-text">اختر الإجابة الصحيحة:</span>
        <div class="flex flex-col gap-2">
          ${optionsHtml}
        </div>
      </div>
    `;
  } else if (question.questionType === "true-false-correction" || question.questionType === "fixed-underlined-true-false") {
    const tfObj = appState.tfAnswers[question.id] || { selected: null, correction: "" };
    
    let isTrueSelected = tfObj.selected === true;
    let isFalseSelected = tfObj.selected === false;

    let questionDisplay = renderUnderlinedQuestion(question.question, question.displayFixedSegments);

    inputAreaHtml = `
      <div class="flex flex-col gap-4">
        <div class="bg-page-bg/40 p-4 rounded-xl border border-borders/40 text-sm font-serif leading-relaxed text-main-text">
          ${questionDisplay}
        </div>
        <div class="flex gap-4">
          <button id="tf-true-btn" class="flex-grow py-3 rounded-xl border font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${isTrueSelected ? "bg-green-600 border-green-600 text-white shadow-sm" : "bg-white border-borders text-muted-text hover:border-green-600 hover:bg-green-50"}" ${isShown ? "disabled" : ""}>
            <i data-lucide="check" class="w-5 h-5"></i>
            <span>صح</span>
          </button>
          <button id="tf-false-btn" class="flex-grow py-3 rounded-xl border font-bold text-sm transition-all cursor-pointer flex items-center justify-center gap-2 ${isFalseSelected ? "bg-red-600 border-red-600 text-white shadow-sm" : "bg-white border-borders text-muted-text hover:border-red-600 hover:bg-red-50"}" ${isShown ? "disabled" : ""}>
            <i data-lucide="x" class="w-5 h-5"></i>
            <span>خطأ</span>
          </button>
        </div>
        <div id="correction-wrapper" class="flex flex-col gap-2 ${isFalseSelected ? "" : "hidden"}">
          <span class="text-xs font-black text-muted-text">اكتب تصحيح الجزء الخاطئ من العبارة أدناه:</span>
          <input type="text" id="correction-input" value="${tfObj.correction || ""}" placeholder="اكتب تصحيح العبارة المناسب هنا..." class="w-full p-2.5 rounded-lg border border-borders bg-white focus:border-primary-purple focus:outline-none text-sm" ${isShown ? "disabled" : ""}>
        </div>
      </div>
    `;
  } else if (question.questionType === "drawing") {
    const hasImage = !!drawingImages[question.id];
    const base64 = drawingImages[question.id] || "";

    inputAreaHtml = `
      <div class="flex flex-col gap-4">
        <!-- Image upload area (Upload only mode) -->
        <div class="flex flex-col gap-3">
          <span class="text-xs font-black text-muted-text">أرفق صورة لمحاولتك بالرسم (مطلوب - حد أقصى 8 ميجابايت):</span>
          <div class="flex items-center gap-3 flex-wrap sm:flex-nowrap">
            <label id="upload-label" class="bg-white border border-borders hover:border-primary-purple hover:bg-soft-lavender/40 transition-all font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm cursor-pointer flex items-center gap-1.5">
              <i data-lucide="camera" class="w-4.5 h-4.5"></i>
              <span>${hasImage ? "استبدال الصورة..." : "اختر ملف صورة..."}</span>
              <input type="file" id="drawing-file-input" class="hidden" accept="image/*">
            </label>
            <span id="file-status" class="text-xs font-bold text-muted-text truncate max-w-[200px]">
              ${hasImage ? "تم إرفاق صورة محاولتك" : "لم يتم إرفاق ملف بعد"}
            </span>
            ${hasImage ? `
              <button id="drawing-delete-btn" class="bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 font-extrabold text-xs py-2 px-3 rounded-xl shadow-sm transition-all cursor-pointer flex items-center gap-1">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
                <span>إزالة الصورة</span>
              </button>
            ` : ""}
          </div>
          <div id="file-error" class="text-xs font-black text-red-600 hidden"></div>
          ${hasImage ? `
            <div class="mt-2 border border-borders rounded-xl overflow-hidden self-start max-w-sm max-h-[220px]">
              <img src="${base64}" class="w-full h-auto object-contain max-h-[220px]" referrerPolicy="no-referrer">
            </div>
            
            <div class="mt-3 p-3.5 bg-indigo-50 border border-indigo-200 rounded-xl text-xs font-black text-indigo-800 flex items-center gap-2">
              <i data-lucide="info" class="w-4 h-4 flex-shrink-0"></i>
              <span>تأكد من دقة الرسم والتأشيرات في كتابك المنهجي</span>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }

  // Model answer layout
  let modelAnswerHtml = "";
  let ratingsHtml = "";

  if (isShown) {
    let displayedAnswer = question.modelAnswer || "";
    if (question.id === "ENR-007") {
      displayedAnswer = "خطأ. التصحيح: توجد مادة الكولاجين ضمن المواد العضوية في تركيب العظم.";
    } else if (question.id === "ENR-021") {
      displayedAnswer = "خطأ. التصحيح: يمر الحبل الشوكي داخل القناة الشوكية.";
    } else if (question.id === "ENR-037") {
      displayedAnswer = "خطأ. التصحيح: تربط الأربطة العظام مع بعضها وتحمي المفاصل.";
    } else if (displayedAnswer.includes("الجزء المسطر ثابت، والتصحيح في الجزء غير المسطر:")) {
      displayedAnswer = displayedAnswer.replace("الجزء المسطر ثابت، والتصحيح في الجزء غير المسطر:", "التصحيح:");
    }
    modelAnswerHtml = `
      <div class="bg-green-50/50 border border-green-200 rounded-2xl p-5 mt-6 flex flex-col gap-3">
        <div class="flex justify-between items-center">
          <span class="inline-flex items-center gap-1 text-xs font-black text-green-700 bg-green-100/80 px-2.5 py-1 rounded-full">
            <i data-lucide="check" class="w-4 h-4"></i>
            <span>الجواب النموذجي:</span>
          </span>
        </div>
        <p class="model-answer-text text-sm font-medium leading-relaxed text-main-text whitespace-pre-wrap">${displayedAnswer}</p>
      </div>
    `;

    // Rating widget (1-10 responsive non-scrolling grid layout)
    const currentRating = appState.ratings[question.id] || null;
    let gridButtons = "";
    for (let r = 1; r <= 10; r++) {
      const isSelected = currentRating === r;
      gridButtons += `
        <button data-rate="${r}" class="rating-btn py-3 text-sm font-black rounded-xl border transition-all cursor-pointer flex items-center justify-center ${isSelected ? "bg-primary-purple border-primary-purple text-white shadow-sm scale-105" : "bg-white border-borders text-muted-text hover:border-primary-purple"}">
          ${r}
        </button>
      `;
    }

    ratingsHtml = `
      <div class="bg-white border border-borders rounded-3xl p-5 mt-6 flex flex-col gap-4">
        <div class="flex flex-col gap-1 text-center">
          <h4 class="text-sm font-black text-main-text">قيّم مستوى إتقانك</h4>
          <p class="text-xs font-bold text-muted-text">اختر تقييمًا من 1 إلى 10 بناءً على جودة محاولتك مقارنة بالجواب النموذجي</p>
        </div>
        <!-- 5x2 grid that ensures all numbers are fully visible on all mobile screens without scrolling -->
        <div class="grid grid-cols-5 gap-2 w-full max-w-md mx-auto">
          ${gridButtons}
        </div>
        ${currentRating ? `
          <div class="text-center text-xs font-black text-primary-purple">
            تصنيف التمكّن الحالي: ${appState.mastery[question.id] === "high" ? "ممتاز (إتقان تام)" : appState.mastery[question.id] === "mid" ? "متوسط (إتقان جزئي)" : "ضعيف (بحاجة لمراجعة)"}
          </div>
        ` : ""}
      </div>
    `;
  }

  // Next and Previous navigation triggers
  const hasPrev = activeIdx > 0;
  const hasNext = activeIdx < totalInFilter - 1;

  setTimeout(() => {
    // --- TRIGGER REGISTRATIONS ---
    // Tab toggles
    document.getElementById("tab-source").addEventListener("click", safeAction(() => {
      activeSection = "source";
      activeIdx = 0;
      renderApp();
    }));
    document.getElementById("tab-enrich").addEventListener("click", safeAction(() => {
      activeSection = "enrichment";
      activeIdx = 0;
      renderApp();
    }));

    // Filter clicks
    const btns = document.querySelectorAll(".filter-btn");
    btns.forEach(btn => {
      btn.addEventListener("click", safeAction((e) => {
        currentFilter = e.target.getAttribute("data-f");
        activeIdx = 0;
        renderApp();
      }));
    });

    // Jump lists clicks
    const jumps = document.querySelectorAll(".jump-btn");
    jumps.forEach(btn => {
      btn.addEventListener("click", safeAction((e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"));
        if (!isNaN(idx) && idx >= 0) {
          activeIdx = idx;
          renderApp();
        }
      }));
    });

    // Text inputs change
    const textInput = document.getElementById("written-input");
    if (textInput) {
      textInput.addEventListener("input", (e) => {
        appState.answers[question.id] = e.target.value;
        saveAppState();
        // Update reveal button disabled state without full re-render
        updateRevealButtonState();
      });
    }

    // Fill blank inputs change
    const blankInputs = document.querySelectorAll(".blank-input");
    blankInputs.forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.getAttribute("data-blank-idx"));
        const total = blankInputs.length;
        if (!appState.fillAnswers[question.id]) {
          appState.fillAnswers[question.id] = Array(total).fill("");
        }
        appState.fillAnswers[question.id][idx] = e.target.value;
        saveAppState();
        updateRevealButtonState();
      });
    });

    // MCQ clicks
    const mcqBtns = document.querySelectorAll(".mcq-option-btn");
    mcqBtns.forEach(btn => {
      btn.addEventListener("click", safeAction((e) => {
        const idx = parseInt(e.currentTarget.getAttribute("data-opt-idx"));
        appState.mcqAnswers[question.id] = idx;
        saveAppState();
        renderApp();
      }));
    });

    // True/False toggles
    const tfTrue = document.getElementById("tf-true-btn");
    const tfFalse = document.getElementById("tf-false-btn");
    if (tfTrue && tfFalse) {
      tfTrue.addEventListener("click", safeAction(() => {
        appState.tfAnswers[question.id] = { selected: true, correction: "" };
        saveAppState();
        renderApp();
      }));
      tfFalse.addEventListener("click", safeAction(() => {
        appState.tfAnswers[question.id] = { selected: false, correction: "" };
        saveAppState();
        renderApp();
      }));
    }

    // Correction text input
    const correctionInput = document.getElementById("correction-input");
    if (correctionInput) {
      correctionInput.addEventListener("input", (e) => {
        const current = appState.tfAnswers[question.id] || { selected: false, correction: "" };
        current.correction = e.target.value;
        appState.tfAnswers[question.id] = current;
        saveAppState();
        updateRevealButtonState();
      });
    }

    // Drawing upload and deletion
    const fileInput = document.getElementById("drawing-file-input");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files ? e.target.files[0] : null;
        if (file) {
          const allowed = ["image/png", "image/jpg", "image/jpeg", "image/webp"];
          const errDiv = document.getElementById("file-error");
          if (!allowed.includes(file.type)) {
            errDiv.textContent = "يرجى اختيار صورة بصيغة PNG أو JPG أو WebP.";
            errDiv.classList.remove("hidden");
            return;
          }
          const maxSize = 8 * 1024 * 1024;
          if (file.size > maxSize) {
            errDiv.textContent = "حجم الصورة كبير جدًا، يرجى اختيار صورة أصغر من 8 ميجابايت.";
            errDiv.classList.remove("hidden");
            return;
          }
          errDiv.classList.add("hidden");

          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result;
            await saveDrawingImage(question.id, base64);
            drawingImages[question.id] = base64;
            renderApp();
          };
          reader.readAsDataURL(file);
        }
      });
    }

    const delBtn = document.getElementById("drawing-delete-btn");
    if (delBtn) {
      delBtn.addEventListener("click", safeAction(async () => {
        await deleteDrawingImage(question.id);
        delete drawingImages[question.id];
        renderApp();
      }));
    }

    // Sub-items change listeners
    const subWrittenInputs = document.querySelectorAll(".sub-written-input");
    subWrittenInputs.forEach(input => {
      input.addEventListener("input", (e) => {
        const subId = e.target.getAttribute("data-sub-id");
        appState.answers[subId] = e.target.value;
        saveAppState();
        updateRevealButtonState();
      });
    });

    const subMcqBtns = document.querySelectorAll(".sub-mcq-option-btn");
    subMcqBtns.forEach(btn => {
      btn.addEventListener("click", safeAction((e) => {
        const subId = e.currentTarget.getAttribute("data-sub-id");
        const idx = parseInt(e.currentTarget.getAttribute("data-opt-idx"));
        appState.mcqAnswers[subId] = idx;
        saveAppState();
        renderApp();
      }));
    });

    // Reveal click
    const revealBtn = document.getElementById("reveal-btn");
    if (revealBtn) {
      revealBtn.addEventListener("click", safeAction(() => {
        appState.shownAnswers[question.id] = true;
        saveAppState();
        renderApp();
      }));
    }

    // Rating click
    const rateBtns = document.querySelectorAll(".rating-btn");
    rateBtns.forEach(btn => {
      btn.addEventListener("click", safeAction((e) => {
        const val = parseInt(e.target.getAttribute("data-rate"));
        appState.ratings[question.id] = val;
        
        // Compute mastery level
        let level = "low";
        if (val >= 8) level = "high";
        else if (val >= 5) level = "mid";
        
        appState.mastery[question.id] = level;
        saveAppState();
        renderApp();
      }));
    });

    // Prev / Next click
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");
    if (prevBtn) {
      prevBtn.addEventListener("click", safeAction(() => {
        if (activeIdx > 0) {
          activeIdx--;
          renderApp();
        }
      }));
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", safeAction(() => {
        if (activeIdx < totalInFilter - 1) {
          activeIdx++;
          renderApp();
        }
      }));
    }

    const resetFilterBtn = document.getElementById("reset-filter-btn");
    if (resetFilterBtn) {
      resetFilterBtn.addEventListener("click", safeAction(() => {
        currentFilter = "all";
        activeIdx = 0;
        renderApp();
      }));
    }

    // First state update on load
    updateRevealButtonState();

  }, 50);

  // Checks if input is valid to enable the reveal button
  function updateRevealButtonState() {
    const revBtn = document.getElementById("reveal-btn");
    if (!revBtn) return;
    
    const valid = isQuestionAttempted(question);
    if (valid) {
      revBtn.removeAttribute("disabled");
      revBtn.classList.remove("opacity-50", "cursor-not-allowed");
      revBtn.classList.add("cursor-pointer", "hover:bg-primary-purple/10");
    } else {
      revBtn.setAttribute("disabled", "true");
      revBtn.classList.add("opacity-50", "cursor-not-allowed");
      revBtn.classList.remove("cursor-pointer", "hover:bg-primary-purple/10");
    }
  }

  // Render question component html
  return `
    <div class="flex flex-col gap-6 max-w-3xl mx-auto w-full">
      ${sidebarHtml}
      ${paginationHtml}

      <!-- Main Active Question Card -->
      <div class="bg-white border border-borders rounded-3xl p-6 md:p-8 shadow-sm flex flex-col gap-5 relative mt-2">
        <!-- Card Header tags -->
        <div class="flex justify-between items-center flex-wrap gap-2">
          <span class="inline-flex items-center gap-1.5 text-xs font-black text-primary-purple bg-soft-lavender px-3 py-1.5 rounded-full select-none">
            <i data-lucide="${activeSection === "source" ? "book-open" : "sparkles"}" class="w-4 h-4"></i>
            <span>${activeSection === "source" ? "سؤال مصدري" : "سؤال إثرائي"}</span>
          </span>
          <span class="text-sm font-black text-muted-text">السؤال ${question.num}</span>
        </div>

        <!-- Question Title -->
        <h2 class="question-text text-lg md:text-xl font-extrabold text-main-text leading-relaxed mt-2">
          ${question.questionType === "fill" ? "أكمل أو أجب عن المطلوب أدناه:" : renderUnderlinedQuestion(question.question, question.displayFixedSegments)}
        </h2>

        <!-- Interactive Interaction area -->
        <div class="mt-2 border-t border-borders pt-4">
          ${inputAreaHtml}
        </div>

        <!-- Reveal Gate button -->
        ${(question.questionType !== "drawing" && !isShown) ? `
          <div class="border-t border-borders pt-6 flex justify-center mt-2">
            <button id="reveal-btn" disabled class="py-3 px-6 rounded-xl border border-primary-purple text-primary-purple font-extrabold text-sm transition-all flex items-center gap-1.5 select-none opacity-50 cursor-not-allowed">
              <i data-lucide="eye" class="w-5 h-5"></i>
              <span>إظهار الجواب النموذجي</span>
            </button>
          </div>
        ` : ""}

        <!-- Model Answer section -->
        ${question.questionType !== "drawing" ? modelAnswerHtml : ""}

        <!-- Self ratings widget -->
        ${question.questionType !== "drawing" ? ratingsHtml : ""}
      </div>

      <!-- Navigation Arrows strip -->
      <div class="flex justify-between items-center w-full mt-2">
        <button id="prev-btn" class="py-3 px-5 bg-white border border-borders text-muted-text hover:text-primary-purple hover:border-primary-purple rounded-xl text-sm font-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${!hasPrev ? "opacity-30 pointer-events-none" : ""}">
          <i data-lucide="arrow-right" class="w-5 h-5"></i>
          <span>السؤال السابق</span>
        </button>
        <button id="next-btn" class="py-3 px-5 bg-white border border-borders text-muted-text hover:text-primary-purple hover:border-primary-purple rounded-xl text-sm font-black transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${!hasNext ? "opacity-30 pointer-events-none" : ""}">
          <span>السؤال التالي</span>
          <i data-lucide="arrow-left" class="w-5 h-5"></i>
        </button>
      </div>
    </div>
  `;
}

// --- RESULTS SCREEN ---
function renderResultsScreen() {
  const sourceLen = window.BIOLOGY_CHAPTER_02.sourceQuestions.length;
  const enrichmentLen = window.BIOLOGY_CHAPTER_02.enrichmentQuestions.length;
  const totalQuestions = sourceLen + enrichmentLen;

  const sourceAttempted = window.BIOLOGY_CHAPTER_02.sourceQuestions.filter(isQuestionAttempted).length;
  const enrichmentAttempted = window.BIOLOGY_CHAPTER_02.enrichmentQuestions.filter(isQuestionAttempted).length;
  const totalAttempted = sourceAttempted + enrichmentAttempted;

  // Compute ratings statistics
  const ratings = Object.values(appState.ratings);
  const totalRated = ratings.length;
  const avgRating = totalRated > 0 ? (ratings.reduce((a, b) => a + b, 0) / totalRated).toFixed(1) : "0.0";

  // Mastery categories
  const masteries = Object.values(appState.mastery);
  const highMastery = masteries.filter(m => m === "high").length;
  const midMastery = masteries.filter(m => m === "mid").length;
  const lowMastery = masteries.filter(m => m === "low").length;

  const unratedCount = totalAttempted - totalRated;

  return `
    <div class="flex flex-col gap-6 max-w-3xl mx-auto w-full">
      <div class="flex flex-col gap-2 border-b border-borders pb-4">
        <h2 class="text-xl font-black text-main-text flex items-center gap-2">
          <i data-lucide="award" class="text-primary-purple w-6 h-6"></i>
          <span>التقرير التحليلي الشامل وإحصائيات التعلم</span>
        </h2>
        <p class="text-xs font-bold text-muted-text">تحليل رقمي دقيق لمستوى استيعابك للمفاهيم ومستويات التمكّن المسجلة.</p>
      </div>

      <!-- Quick Metrics dashboard -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
        <div class="bg-white border border-borders p-4 rounded-2xl shadow-sm text-center flex flex-col gap-1">
          <span class="text-xs font-black text-muted-text">الأسئلة المجاب عنها</span>
          <span class="text-xl font-black text-primary-purple">${totalAttempted} / ${totalQuestions}</span>
        </div>
        <div class="bg-white border border-borders p-4 rounded-2xl shadow-sm text-center flex flex-col gap-1">
          <span class="text-xs font-black text-muted-text">معدل التقييم الذاتي</span>
          <span class="text-xl font-black text-green-600">${avgRating} / 10</span>
        </div>
        <div class="bg-white border border-borders p-4 rounded-2xl shadow-sm text-center flex flex-col gap-1">
          <span class="text-xs font-black text-muted-text">المستوى الممتاز</span>
          <span class="text-xl font-black text-indigo-600">${highMastery} أسئلة</span>
        </div>
        <div class="bg-white border border-borders p-4 rounded-2xl shadow-sm text-center flex flex-col gap-1">
          <span class="text-xs font-black text-muted-text">غير المقيمة بعد</span>
          <span class="text-xl font-black text-amber-600">${unratedCount} أسئلة</span>
        </div>
      </div>

      <!-- Details analysis card -->
      <div class="bg-white border border-borders rounded-3xl p-6 md:p-8 shadow-sm flex flex-col gap-5 mt-2">
        <h3 class="text-base font-black text-main-text border-b border-borders pb-3">تحليل الأداء حسب المجموعات</h3>
        
        <div class="flex flex-col gap-4">
          <!-- Item 1: Source questions progress -->
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center text-xs font-black">
              <span class="text-main-text">الأسئلة المنهجية (الكتاب المدرسي)</span>
              <span class="text-primary-purple">${sourceAttempted} من ${sourceLen}</span>
            </div>
            <div class="w-full bg-page-bg rounded-full h-2.5 overflow-hidden">
              <div class="bg-primary-purple h-full rounded-full" style="width: ${Math.round((sourceAttempted / sourceLen) * 100)}%"></div>
            </div>
          </div>

          <!-- Item 2: Enrichment questions progress -->
          <div class="flex flex-col gap-2">
            <div class="flex justify-between items-center text-xs font-black">
              <span class="text-main-text">الأسئلة الإثرائية</span>
              <span class="text-primary-purple">${enrichmentAttempted} من ${enrichmentLen}</span>
            </div>
            <div class="w-full bg-page-bg rounded-full h-2.5 overflow-hidden">
              <div class="bg-primary-purple h-full rounded-full" style="width: ${Math.round((enrichmentAttempted / enrichmentLen) * 100)}%"></div>
            </div>
          </div>
        </div>

        <!-- Mastery distribution grid -->
        <h3 class="text-base font-black text-main-text border-b border-borders pb-3 mt-4">توزيع مستويات التمكّن الدراسي</h3>
        <div class="grid grid-cols-3 gap-4">
          <div class="bg-indigo-50/50 border border-indigo-100 p-4 rounded-2xl text-center flex flex-col gap-1">
            <span class="text-xs font-black text-indigo-700">ممتاز (8-10)</span>
            <span class="text-lg font-black text-indigo-900">${highMastery}</span>
          </div>
          <div class="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl text-center flex flex-col gap-1">
            <span class="text-xs font-black text-amber-700">متوسط (5-7)</span>
            <span class="text-lg font-black text-amber-900">${midMastery}</span>
          </div>
          <div class="bg-red-50/50 border border-red-100 p-4 rounded-2xl text-center flex flex-col gap-1">
            <span class="text-xs font-black text-red-700">ضعيف (1-4)</span>
            <span class="text-lg font-black text-red-900">${lowMastery}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --- INIT APP ---
window.addEventListener("DOMContentLoaded", async () => {
  loadAppState();
  await loadAllDrawings();
  renderApp();
});
