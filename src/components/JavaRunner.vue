<script setup>
import { ref, computed, watch } from 'vue'

// ── Props ─────────────────────────────────────────────────────────────────────
// ── Built-in code library (avoids template literal issues in .md files) ─────
const CODE_LIBRARY = {}

const props = defineProps({
  /** The language to use in OneCompiler. Supported: java, python, cpp */
  language: {
    type: String,
    default: 'c'
  },
  /** Key from CODE_LIBRARY to use as starter code */
  codeKey: {
    type: String,
    default: ''
  },
  /** Direct starter code string (URL-encoded automatically) — use codeKey when possible */
  starterCode: {
    type: String,
    default: ''
  },
  /** Hide the input panel */
  hideStdin: {
    type: Boolean,
    default: false
  },
  /** Title shown in the header bar */
  title: {
    type: String,
    default: ''
  },
  /** Theme: dark | light */
  theme: {
    type: String,
    default: 'light'
  }
})

// Resolved code: codeKey takes priority over starterCode
const resolvedCode = computed(() => {
  if (props.codeKey && CODE_LIBRARY[props.codeKey]) {
    return CODE_LIBRARY[props.codeKey]
  }
  return props.starterCode
})

// ── OneCompiler language IDs ──────────────────────────────────────────────────
// Note: OneCompiler embed uses 'python' not 'python3'
const OC_LANG_MAP = {
  java:    'java',
  python:  'python',
  python3: 'python',
  cpp:     'cpp',
  c:       'c',
  js:      'javascript',
  javascript: 'javascript'
}

// Track the language actively selected in OneCompiler
const activeLang = ref(props.language)

const ocLang = computed(() => OC_LANG_MAP[props.language] || props.language)

// Supported languages in Python Tutor
const ptLang = computed(() => {
  const lang = activeLang.value.toLowerCase()
  if (lang === 'python' || lang === 'python3') return '3'
  if (lang === 'java') return 'java'
  if (lang === 'cpp' || lang === 'c++') return 'cpp'
  if (lang === 'c') return 'c'
  if (lang === 'js' || lang === 'javascript') return 'js'
  if (lang === 'ruby') return 'ruby'
  return null
})

const isVisualizerSupported = computed(() => ptLang.value !== null)

const langLabel = computed(() => {
  const l = activeLang.value
  return l.charAt(0).toUpperCase() + l.slice(1)
})

// ── OneCompiler iframe URL ────────────────────────────────────────────────────
// OneCompiler supports an iframe embed with a `?theme=` and `?hideNewFileOption=` param.
// Code can be pre-filled via the `?code=` query param (URL-encoded).
const STORAGE_KEY = `oc-code-${props.language}-${props.codeKey || 'default'}`

const oneCompilerUrl = computed(() => {
  const base = `https://onecompiler.com/embed/${ocLang.value}`
  const params = new URLSearchParams({
    theme: props.theme,
    hideNewFileOption: 'false',
    hideStdin: props.hideStdin ? 'true' : 'false',
    hideTitle: 'true',
    listenToEvents: 'true',
    codeChangeEvent: 'true',
    fontSize: '16',
  })

  const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const savedCode = saved ? (() => { try { return JSON.parse(saved).code } catch(e){ return null } })() : null
  const initialCode = savedCode || resolvedCode.value || ''

  if (initialCode) params.set('code', initialCode)
  return `${base}?${params.toString()}`
})

// ── Python Tutor Visualizer & Fullscreen Compiler ────────────────────────────
const showVisualizer = ref(false)
const showVisualizerWarning = ref(false)
const showCompiler = ref(false)

const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
const savedCode = saved ? (() => { try { return JSON.parse(saved).code } catch(e){ return null } })() : null
const initialCode = savedCode || resolvedCode.value || ''

const visualizerCode = ref(initialCode)
const visualizerStdin = ref('')
const ocFrameRef = ref(null)

const openVisualizer = () => {
  const code = visualizerCode.value || resolvedCode.value || ''
  if (!code.trim()) {
    showVisualizerWarning.value = true
    return
  }
  showVisualizer.value = true
}

const openCompiler = () => {
  showCompiler.value = true
  showVisualizer.value = false
}

const visualizerUrl = computed(() => {
  if (!ptLang.value) return ''
  const encodedCode = encodeURIComponent(visualizerCode.value || resolvedCode.value || '')
  const inputLines = visualizerStdin.value ? visualizerStdin.value.split('\n') : []
  const encodedInput = encodeURIComponent(JSON.stringify(inputLines))
  return `https://pythontutor.com/iframe-embed.html#code=${encodedCode}&cumulative=false&heapPrimitives=nevernest&mode=display&origin=opt-frontend.js&py=${ptLang.value}&rawInputLstJSON=${encodedInput}&textReferences=false`
})

const fullscreenCompilerUrl = computed(() => {
  const base = `https://onecompiler.com/embed/${ocLang.value}`
  const params = new URLSearchParams({
    theme: props.theme,
    hideNewFileOption: 'false',
    hideStdin: props.hideStdin ? 'true' : 'false',
    hideTitle: 'true',
    listenToEvents: 'true',
    codeChangeEvent: 'true',
    fontSize: '20',
  })
  const liveCode = visualizerCode.value || resolvedCode.value
  if (liveCode) {
    params.set('code', liveCode)
  }
  return `${base}?${params.toString()}`
})

const onIframeLoad = () => {
  try {
    ocFrameRef.value?.contentWindow?.postMessage(
      { type: 'settings', fontSize: 20 },
      'https://onecompiler.com'
    )
  } catch(e) {}
}

const emit = defineEmits(['update:code', 'update:language', 'codeChange', 'languageChange'])

// Listen for postMessage from OneCompiler iframe so we can grab the latest code and stdin
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (!event.data) return

    // Ignore Vue devtools or other non-OneCompiler messages safely
    if (event.data.source === 'vue-devtools-proxy') return

    // Ensure the message came from OUR iframe or OneCompiler domain
    if (ocFrameRef.value && event.source && event.source !== ocFrameRef.value.contentWindow) return

    // Update active language from the editor
    if (event.data.language && typeof event.data.language === 'string') {
      activeLang.value = event.data.language
      emit('update:language', activeLang.value)
      emit('languageChange', activeLang.value)
    }
    
    // Extract code: aggressively look for the code payload in various OneCompiler formats
    let newCode = null
    if (event.data.files && Array.isArray(event.data.files) && event.data.files.length > 0 && event.data.files[0].content !== undefined) {
      newCode = event.data.files[0].content
    } else if (typeof event.data.code === 'string') {
      newCode = event.data.code
    } else if (typeof event.data.data === 'string' && event.data.type !== 'result') {
      newCode = event.data.data
    }

    if (newCode !== null && newCode !== undefined && newCode !== '') {
      visualizerCode.value = newCode
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          code: newCode,
          lang: activeLang.value,
          savedAt: new Date().toISOString()
        }))
      } catch (e) {}
      emit('update:code', newCode)
      emit('codeChange', newCode)
    }

    // Extract stdin if present in the payload
    if (typeof event.data.stdin === 'string') {
      visualizerStdin.value = event.data.stdin
    }
    // Save to localStorage when Run is clicked
    if (event.data.type === 'result') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          code: visualizerCode.value,
          lang: activeLang.value,
          savedAt: new Date().toISOString()
        }))
      } catch (e) {}
    }
  })
}

// Watch initial code
watch(
  () => resolvedCode.value,
  (code) => {
    if (code && !visualizerCode.value) {
      visualizerCode.value = code
      emit('update:code', code)
    }
  },
  { immediate: true }
)

defineExpose({
  getCode: () => visualizerCode.value || resolvedCode.value || '',
  getLanguage: () => activeLang.value || props.language
})
</script>

<template style="width:100%; height:100vh;">
  <div class="oc-slide">
    <!-- ── Header bar ─────────────────────────────────────────────────── -->
    <div class="oc-header">
      <div class="oc-header-left">
        <span class="oc-lang-badge">{{ langLabel }}</span>
        <span v-if="title" class="oc-title">{{ title }}</span>
      </div>
      <div class="oc-header-right">
        <button @click="openCompiler" class="oc-pill oc-pill--link">Full Screen</button>
        <button 
          class="oc-pill oc-pill--visualize" 
          :class="{ 'oc-pill--disabled': !isVisualizerSupported }"
          @click="isVisualizerSupported ? openVisualizer() : null" 
          :title="isVisualizerSupported ? 'Visualize with Python Tutor' : 'Visualizer is not available for this programming language'"
        >
          <svg class="oc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          Visualize
        </button>
      </div>
    </div>

    <!-- ── OneCompiler iframe ──────────────────────────────────────────── -->
    <div class="oc-frame-wrap">
      <iframe
        ref="ocFrameRef"
        :src="oneCompilerUrl"
        class="oc-frame"
        frameborder="0"
        allowfullscreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
        id="compiler-text-area"
        @load="onIframeLoad"
      ></iframe>
    </div>

    <!-- ── Python Tutor Modal ─────────────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="fade">
      <div v-if="showVisualizer" class="pt-overlay" @click.self="showVisualizer = false" style="z-index: 2;">
        <div class="pt-modal">
          <div class="pt-modal-header">
            <div class="pt-modal-title">
              <svg class="oc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#6366f1">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M9 21V9"/>
              </svg>
              Memory Visualizer
              <span class="pt-powered">via Python Tutor</span>
            </div>
            <div class="pt-modal-actions">
              <button class="pt-close-btn" @click="showVisualizer = false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
                Close
              </button>
            </div>
          </div>
          <iframe :src="visualizerUrl" class="pt-frame" frameborder="0" style="padding: 20px;"></iframe>
        </div>
      </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="fade">
      <div v-if="showCompiler" class="pt-overlay" @click.self="showCompiler = false" style="z-index: 1;">
        <div class="pt-modal">
          <div class="pt-modal-header">
            <div class="pt-modal-title">
              <svg class="oc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#6366f1">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M9 21V9"/>
              </svg>
              Online Compiler
              <span class="pt-powered">via Faceprep</span>
            </div>
            <div class="pt-modal-actions">
              <button 
                style="padding: 6px 10px; font-size: .7rem;" class="oc-pill oc-pill--visualize" 
                :class="{ 'oc-pill--disabled': !isVisualizerSupported }"
                @click="isVisualizerSupported ? openVisualizer() : null" 
                :title="isVisualizerSupported ? 'Visualize with Python Tutor' : 'Visualizer is not available for this programming language'"
              >
                <svg class="oc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                Visualize
              </button>
              <button class="pt-close-btn" @click="showCompiler = false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
                Close
              </button>
            </div>
          </div>
          <iframe style="height:100%;"
            ref="ocFrameRef"
            :src="oneCompilerUrl"
            class="oc-frame"
            frameborder="0"
            allowfullscreen
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
            @load="onIframeLoad"
          ></iframe>
        </div>
      </div>
      </Transition>
    </Teleport>

    <!-- ── Visualizer Warning Modal ──────────────────────────────────── -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="showVisualizerWarning" class="pt-overlay" @click.self="showVisualizerWarning = false" style="z-index: 10;">
          <div class="vw-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="vw-icon">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p class="vw-title">No Code to Visualize</p>
            <p class="vw-text">Please write and run your code in the editor first, then click Visualize.</p>
            <button class="vw-btn" @click="showVisualizerWarning = false">Got it</button>
          </div>
        </div>
      </Transition>
    </Teleport>
    
  </div>
</template>

<style scoped>


/* ── Container ───────────────────────────────────────────────────────── */
.oc-slide {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1 1 auto;
  border-radius: 5px;
  overflow: hidden;
}

/* ── Header bar ──────────────────────────────────────────────────────── */
.oc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  
  background: #232323e9;
  flex-shrink: 0;
  gap: 10px;
  height: 35px;
}

.oc-header-left {
  display: flex;
  align-items: center;
  gap: 7px;
}

.oc-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  
}

.oc-lang-badge {
  color: #fcfcfc;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-left: 2px;
}

.oc-title {
  font-size: 0.82rem;
  color: #fcfcfc;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

/* ── Pills (shared button/link style) ───────────────────────────────── */
.oc-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
  border: none;
  text-decoration: none;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 2px 6px;
}

.oc-pill--visualize {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  /* box-shadow: 0 2px 8px rgba(99,102,241,0.35); */
}
.oc-pill--visualize:hover {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  /* box-shadow: 0 4px 12px rgba(99,102,241,0.45); */
}

.oc-pill--link {
  background: rgba(255,255,255,0.07);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.12);
}
.oc-pill--link:hover {
  background: rgba(255,255,255,0.12);
  color: #e2e8f0;
  /* transform: translateY(-1px); */
}

.oc-pill--disabled {
  background: #334155 !important;
  color: #64748b !important;
  cursor: not-allowed !important;
  box-shadow: none !important;
  transform: none !important;
}

.oc-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}


/* ── OneCompiler frame ───────────────────────────────────────────────── */
.oc-frame-wrap {
  /* flex: 1;
  overflow: hidden;
  background: #ffffff;
  width: 100%;
  height: 100%; */
  width: 100%;
  height: 100%;
  /* background-color: palevioletred; */
}

.oc-frame {
  width: 100%;
  display: block;
  border: none;
  height: 100%;
  zoom: .7;
}

/* ── Python Tutor Modal Overlay ──────────────────────────────────────── */
.pt-overlay {
 position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  background: rgba(241, 245, 249, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  font-family: 'Inter', system-ui, sans-serif;
  box-sizing: border-box;
}

.pt-modal {
  width: 90%;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  
  box-shadow: 0 20px 40px -15px rgba(15, 23, 42, 0.1);
  display: flex;
  flex-direction: column;
  height: 80%;
  box-sizing: border-box;
}

.pt-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #232323e9;
  flex-shrink: 0;
  gap: 12px;
}

.pt-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
  font-weight: 700;
  color: #e2e8f0;
}

.pt-powered {
  font-size: 0.72rem;
  font-weight: 500;
  color: #64748b;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 1px 7px;
  margin-left: 4px;
}

.pt-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pt-notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: rgba(245,158,11,0.08);
  border-bottom: 1px solid rgba(245,158,11,0.2);
  font-size: 0.73rem;
  color: #fbbf24;
  flex-shrink: 0;
}

.pt-close-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}
.pt-close-btn:hover {
  background: #dc2626;
}

.pt-frame {
  flex: 1;
  width: 100%;
  border: none;
  background: white;
}

/* ── Visualizer Warning Card ─────────────────────────────────────── */
.vw-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 2rem 2.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 340px;
  text-align: center;
}
.vw-icon {
  width: 42px;
  height: 42px;
  color: #ef5050;
}
.vw-title {
  color: #2b2b2b;
  font-size: 1.3rem;
  font-weight: 700;
  margin: 0;
}
.vw-text {
   color: #2b2b2bca;
  font-size: .9rem;
  margin: 0;
  line-height: 1.5;
}
.vw-btn {
  margin-top: 0.25rem;
  background: #ef5050;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 8px 28px;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
}
.vw-btn:hover { background: #db3b3b; }
</style>