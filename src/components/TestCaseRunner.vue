<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  /** Array of test cases: [{ id, name, input, expectedOutput, isHidden }] */
  testCases: {
    type: Array,
    default: () => []
  },
  /** Current user code to test */
  code: {
    type: String,
    default: ''
  },
  /** Programming language */
  language: {
    type: String,
    default: 'java'
  }
})

const emit = defineEmits(['update:results'])

// Active tab inside runner: 'testcases' | 'custom'
const activeTab = ref('testcases')
const selectedTestCaseId = ref(props.testCases[0]?.id || 1)

// Test case execution results map: id -> { status, actualOutput, stderr, error, executionTime }
// status: 'idle' | 'running' | 'passed' | 'failed' | 'error'
const results = ref({})
const isRunningAll = ref(false)
const copiedId = ref(null)

// Custom input runner state
const customInput = ref('')
const customOutput = ref('')
const customError = ref('')
const customTime = ref(null)
const isRunningCustom = ref(false)

// Normalize string for robust output comparison (trim whitespace, normalize line breaks)
function normalizeOutput(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

// Language configuration mapping for OneCompiler
const LANG_MAP = {
  java: { name: 'Java', filename: 'Main.java' },
  python: { name: 'Python', filename: 'main.py' },
  python3: { name: 'Python', filename: 'main.py' },
  c: { name: 'C', filename: 'main.c' },
  cpp: { name: 'Cpp', filename: 'main.cpp' },
  'c++': { name: 'Cpp', filename: 'main.cpp' },
  javascript: { name: 'Javascript', filename: 'index.js' },
  js: { name: 'Javascript', filename: 'index.js' }
}

const remainingCredits = ref(null)

// Helper to get latest code from props or localStorage
function getEffectiveCode() {
  if (props.code && props.code.trim()) return props.code
  try {
    // Check all localStorage keys starting with oc-code
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('oc-code-')) {
        const item = localStorage.getItem(key)
        if (item) {
          const parsed = JSON.parse(item)
          if (parsed.code && parsed.code.trim()) return parsed.code
        }
      }
    }
  } catch (e) {}
  return props.code || ''
}

// Core execution helper — calls /api/run
async function executeCode(codeToRun, inputStr, lang) {
  const normLang = (lang || 'java').toLowerCase()
  const payload = {
    code: codeToRun,
    input: inputStr || '',
    language: normLang
  }

  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  let data
  try {
    data = await res.json()
  } catch (e) {
    throw new Error(`Server returned HTTP ${res.status}`)
  }

  if (data.creditsRemaining !== undefined && data.creditsRemaining !== null) {
    remainingCredits.value = data.creditsRemaining
  }

  if (!data.success && data.error) {
    return {
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      exception: data.error || data.exception || 'Execution error',
      executionTime: data.executionTime || 0
    }
  }

  return {
    stdout: data.stdout || '',
    stderr: data.stderr || '',
    exception: data.exception || null,
    executionTime: data.executionTime || 0
  }
}

// ── Toast Notification System ────────────────────────────────────────────────
const toasts = ref([])
let toastIdCounter = 0

function showToast({ type = 'info', title, message = '', duration = 3000 }) {
  const id = ++toastIdCounter
  const toast = {
    id,
    type,
    title,
    message,
    timer: null
  }

  // Auto dismiss after 3 seconds
  toast.timer = setTimeout(() => {
    removeToast(id)
  }, duration)

  toasts.value.push(toast)
}

function removeToast(id) {
  const index = toasts.value.findIndex((t) => t.id === id)
  if (index !== -1) {
    if (toasts.value[index].timer) {
      clearTimeout(toasts.value[index].timer)
    }
    toasts.value.splice(index, 1)
  }
}

// Run single test case
async function runSingleTestCase(tc, fromSingleButton = false) {
  const codeToRun = getEffectiveCode()
  if (!codeToRun || !codeToRun.trim()) {
    results.value[tc.id] = {
      status: 'error',
      error: 'Please write code in the editor before running test cases.'
    }
    if (fromSingleButton) {
      showToast({
        type: 'error',
        title: `${tc.name || 'Test Case'} Failed`,
        message: 'No code in editor to execute.',
        duration: 3000
      })
    }
    return
  }

  results.value[tc.id] = {
    status: 'running',
    actualOutput: '',
    error: '',
    executionTime: null
  }

  try {
    const res = await executeCode(codeToRun, tc.input, props.language)
    const rawStdout = res.stdout || ''
    const normActual = normalizeOutput(rawStdout)
    const normExpected = normalizeOutput(tc.expectedOutput)

    if (res.exception || (res.stderr && !rawStdout)) {
      results.value[tc.id] = {
        status: 'error',
        actualOutput: rawStdout,
        error: res.exception || res.stderr || 'Runtime error',
        executionTime: res.executionTime
      }
      if (fromSingleButton) {
        showToast({
          type: 'error',
          title: `${tc.name || 'Test Case'} Error`,
          message: res.exception || res.stderr || 'Runtime error',
          duration: 3000
        })
      }
    } else {
      const isPassed = normActual === normExpected
      results.value[tc.id] = {
        status: isPassed ? 'passed' : 'failed',
        actualOutput: rawStdout,
        error: res.stderr || '',
        executionTime: res.executionTime
      }
      if (fromSingleButton) {
        showToast({
          type: isPassed ? 'success' : 'error',
          title: isPassed ? `${tc.name || 'Test Case'} Passed` : `${tc.name || 'Test Case'} Failed`,
          message: isPassed ? 'Output matched expected result.' : 'Output did not match expected result.',
          duration: 3000
        })
      }
    }
  } catch (err) {
    results.value[tc.id] = {
      status: 'error',
      error: err.message || 'Execution failed'
    }
    if (fromSingleButton) {
      showToast({
        type: 'error',
        title: `${tc.name || 'Test Case'} Error`,
        message: err.message || 'Execution failed',
        duration: 3000
      })
    }
  }

  emit('update:results', results.value)
}

// Run all test cases in batch
async function runAllTestCases() {
  const codeToRun = getEffectiveCode()
  if (!codeToRun || !codeToRun.trim()) {
    showToast({
      type: 'error',
      title: 'No Code to Run',
      message: 'Please write code in the editor before running test cases.',
      duration: 3000
    })
    return
  }

  isRunningAll.value = true
  activeTab.value = 'testcases'

  // Mark all as running
  props.testCases.forEach((tc) => {
    results.value[tc.id] = {
      status: 'running',
      actualOutput: '',
      error: '',
      executionTime: null
    }
  })

  // Run test cases sequentially to prevent rate limits and give smooth feedback
  for (const tc of props.testCases) {
    await runSingleTestCase(tc, false)
  }

  isRunningAll.value = false

  // Trigger Toast Notification on top-right
  const totalCount = props.testCases.length
  const passedCount = props.testCases.filter((tc) => results.value[tc.id]?.status === 'passed').length

  if (passedCount === totalCount) {
    showToast({
      type: 'success',
      title: 'All Test Cases Passed!',
      message: `${passedCount}/${totalCount} test cases passed successfully.`,
      duration: 3000
    })
  } else {
    showToast({
      type: 'error',
      title: `${passedCount}/${totalCount} Test Cases Passed`,
      message: `${totalCount - passedCount} test case(s) failed. Check details below.`,
      duration: 3000
    })
  }
}

// Run custom input
async function runCustomInput() {
  const codeToRun = getEffectiveCode()
  if (!codeToRun || !codeToRun.trim()) {
    customError.value = 'Please write code in the editor before running.'
    return
  }

  isRunningCustom.value = true
  customOutput.value = ''
  customError.value = ''
  customTime.value = null

  try {
    const res = await executeCode(codeToRun, customInput.value, props.language)
    customOutput.value = res.stdout || ''
    if (res.exception || res.stderr) {
      customError.value = res.exception || res.stderr
    }
    customTime.value = res.executionTime
  } catch (err) {
    customError.value = err.message || 'Execution error'
  } finally {
    isRunningCustom.value = false
  }
}

// Copy helper
async function copyInput(text, id) {
  try {
    await navigator.clipboard.writeText(text)
    copiedId.value = id
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = null
    }, 2000)
  } catch (e) {}
}

// Computed stats
const stats = computed(() => {
  const total = props.testCases.length
  let passed = 0
  let failed = 0
  let running = 0
  let hasRun = false

  props.testCases.forEach((tc) => {
    const r = results.value[tc.id]
    if (r) {
      hasRun = true
      if (r.status === 'passed') passed++
      else if (r.status === 'failed' || r.status === 'error') failed++
      else if (r.status === 'running') running++
    }
  })

  return { total, passed, failed, running, hasRun }
})

// Current selected test case object
const currentTestCase = computed(() => {
  return props.testCases.find((tc) => tc.id === selectedTestCaseId.value) || props.testCases[0]
})

// Watch test cases prop to reset selection if needed
watch(
  () => props.testCases,
  (newVal) => {
    if (newVal && newVal.length > 0 && !newVal.some((tc) => tc.id === selectedTestCaseId.value)) {
      selectedTestCaseId.value = newVal[0].id
    }
  },
  { immediate: true }
)

defineExpose({
  runAllTestCases,
  runSingleTestCase
})
</script>

<template>
  <div class="tc-container">
    <!-- ── Top Action & Summary Bar ──────────────────────────────────────── -->
    <div class="tc-top-bar">
      <div class="tc-sub-tabs">
        <button
          class="tc-sub-tab"
          :class="{ 'tc-sub-tab--active': activeTab === 'testcases' }"
          @click="activeTab = 'testcases'"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tc-tab-icon">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          Test Cases
          <span class="tc-count-badge">{{ props.testCases.length }}</span>
        </button>
      </div>

      <div class="tc-actions">
        <!-- Live Run All Button -->
        <button
          v-if="activeTab === 'testcases'"
          class="tc-run-all-btn"
          :class="{ 'tc-run-all-btn--running': isRunningAll }"
          :disabled="isRunningAll"
          @click="runAllTestCases"
          title="Run code against all test cases"
        >
          <svg v-if="!isRunningAll" viewBox="0 0 24 24" fill="currentColor" class="tc-play-icon">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span v-else class="tc-spinner"></span>
          {{ isRunningAll ? 'Testing...' : 'Run Tests' }}
        </button>
      </div>
    </div>

    <!-- ── Tab 1: Test Cases View ────────────────────────────────────────── -->
    <div v-if="activeTab === 'testcases'" class="tc-body">
      <!-- Test Cases Horizontal Selector / Chips -->
      <div class="tc-chips-scroll">
        <button
          v-for="(tc, idx) in props.testCases"
          :key="tc.id"
          class="tc-chip"
          :class="{
            'tc-chip--selected': selectedTestCaseId === tc.id,
            'tc-chip--passed': results[tc.id]?.status === 'passed',
            'tc-chip--failed': results[tc.id]?.status === 'failed' || results[tc.id]?.status === 'error',
            'tc-chip--running': results[tc.id]?.status === 'running'
          }"
          @click="selectedTestCaseId = tc.id"
        >
          <span class="tc-chip-status">
            <span v-if="results[tc.id]?.status === 'running'" class="tc-spinner-xs"></span>
            <span v-else-if="results[tc.id]?.status === 'passed'">✓</span>
            <span v-else-if="results[tc.id]?.status === 'failed' || results[tc.id]?.status === 'error'">✕</span>
            <span v-else class="tc-chip-dot"></span>
          </span>
          <span class="tc-chip-label">{{ tc.name || `Case ${idx + 1}` }}</span>
          <!-- <span v-if="tc.isHidden" class="tc-hidden-icon" title="Hidden Test Case">🔒</span> -->
        </button>
      </div>

      <!-- Selected Test Case Detail Card -->
      <div v-if="currentTestCase" class="tc-detail-card">
        <div class="tc-detail-header">
          <div class="tc-detail-title">
            <span class="tc-case-badge">{{ currentTestCase.name || `Test Case ${currentTestCase.id}` }}</span>
            <!-- <span v-if="currentTestCase.isHidden" class="tc-badge-hidden">Hidden Case</span> -->
            <span v-if="results[currentTestCase.id]?.executionTime !== null && results[currentTestCase.id]?.executionTime !== undefined" class="tc-time-badge">
              ⚡ {{ results[currentTestCase.id].executionTime }}ms
            </span>
          </div>

          <button
            class="tc-run-single-btn"
            :disabled="results[currentTestCase.id]?.status === 'running'"
            @click="runSingleTestCase(currentTestCase)"
            title="Run only this test case"
          >
            <span v-if="results[currentTestCase.id]?.status === 'running'" class="tc-spinner-xs"></span>
            <span v-else>▶ Run Case</span>
          </button>
        </div>

        <!-- Hidden Test Case Display (Input and Expected Output always protected) -->
        <div v-if="currentTestCase.isHidden" class="tc-hidden-box" :class="{
          'tc-hidden-box--passed': results[currentTestCase.id]?.status === 'passed',
          'tc-hidden-box--failed': results[currentTestCase.id]?.status === 'failed',
          'tc-hidden-box--error': results[currentTestCase.id]?.status === 'error'
        }">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tc-lock-icon">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div class="tc-hidden-content">
            <div class="tc-hidden-title">
              <span v-if="results[currentTestCase.id]?.status === 'passed'" class="tc-text-success">✓ Passed (Hidden Case)</span>
              <span v-else-if="results[currentTestCase.id]?.status === 'failed'" class="tc-text-danger">✕ Failed (Hidden Case)</span>
              <span v-else-if="results[currentTestCase.id]?.status === 'error'" class="tc-text-danger">⚠️ Error (Hidden Case)</span>
              <span v-else>Hidden Test Case</span>
            </div>
            <div class="tc-hidden-desc">
              <span v-if="results[currentTestCase.id]?.status === 'passed'">Your program produced the correct output for this hidden test case.</span>
              <span v-else-if="results[currentTestCase.id]?.status === 'failed'">Your program did not produce the expected output for this hidden test case.</span>
              <span v-else-if="results[currentTestCase.id]?.status === 'error'">Runtime or compilation error occurred while executing this hidden case.</span>
              <span v-else>Input and expected output are hidden for assessment. Click "Run Tests" to evaluate.</span>
            </div>

            <!-- Error details if compilation error -->
            <div v-if="results[currentTestCase.id]?.error" class="tc-error-box" style="margin-top: 6px;">
              <div class="tc-error-header">Error Details:</div>
              <pre class="tc-error-pre">{{ results[currentTestCase.id]?.error }}</pre>
            </div>
          </div>
        </div>

        <!-- Normal Visible Test Case Details -->
        <template v-else>
          <!-- Input Block -->
          <div class="tc-block">
            <div class="tc-block-label">
              <span>Input</span>
              <button v-if="currentTestCase.input" class="tc-copy-btn" @click="copyInput(currentTestCase.input, currentTestCase.id)">
                {{ copiedId === currentTestCase.id ? 'Copied!' : 'Copy' }}
              </button>
            </div>
            <pre class="tc-code-box"><code>{{ currentTestCase.input || '(No Input / Empty)' }}</code></pre>
          </div>

          <!-- Expected Output Block -->
          <div class="tc-block">
            <div class="tc-block-label">Expected Output</div>
            <pre class="tc-code-box"><code>{{ currentTestCase.expectedOutput || '(No Output / Empty)' }}</code></pre>
          </div>

          <!-- Actual Output Block (if run) -->
          <div v-if="results[currentTestCase.id]?.status && results[currentTestCase.id]?.status !== 'running'" class="tc-block">
            <div class="tc-block-label" :class="{
              'tc-text-success': results[currentTestCase.id]?.status === 'passed',
              'tc-text-danger': results[currentTestCase.id]?.status === 'failed' || results[currentTestCase.id]?.status === 'error'
            }">
              <span>Actual Output</span>
              <span class="tc-badge-status" :class="`tc-badge-status--${results[currentTestCase.id]?.status}`">
                {{ results[currentTestCase.id]?.status === 'passed' ? 'PASSED' : results[currentTestCase.id]?.status === 'failed' ? 'FAILED' : 'ERROR' }}
              </span>
            </div>
            <pre class="tc-code-box" :class="{
              'tc-code-box--passed': results[currentTestCase.id]?.status === 'passed',
              'tc-code-box--failed': results[currentTestCase.id]?.status === 'failed' || results[currentTestCase.id]?.status === 'error'
            }"><code>{{ results[currentTestCase.id]?.actualOutput || '(No Output / Empty)' }}</code></pre>

            <!-- Error / Stderr box if any -->
            <div v-if="results[currentTestCase.id]?.error" class="tc-error-box">
              <div class="tc-error-header">Runtime / Compilation Details:</div>
              <pre class="tc-error-pre">{{ results[currentTestCase.id]?.error }}</pre>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ── Tab 2: Custom Input View ──────────────────────────────────────── -->
    <div v-if="activeTab === 'custom'" class="tc-body">
      <div class="tc-custom-wrap">
        <div class="tc-block">
          <div class="tc-block-label">Custom Standard Input (stdin)</div>
          <textarea
            v-model="customInput"
            class="tc-textarea"
            placeholder="Type custom input for your program here (e.g. 12)..."
            rows="3"
          ></textarea>
        </div>

        <div v-if="customOutput || customError || customTime !== null" class="tc-block">
          <div class="tc-block-label">
            <span>Execution Output</span>
            <span v-if="customTime !== null" class="tc-time-badge">⚡ {{ customTime }}ms</span>
          </div>
          <pre v-if="customOutput" class="tc-code-box"><code>{{ customOutput }}</code></pre>
          <div v-if="customError" class="tc-error-box">
            <div class="tc-error-header">Error / Trace:</div>
            <pre class="tc-error-pre">{{ customError }}</pre>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Toast Notifications (Top-Right Stacking) ────────────────────────── -->
    <Teleport to="body">
      <div class="tc-toast-container">
        <TransitionGroup name="toast">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            class="tc-toast"
            :class="`tc-toast--${toast.type}`"
          >
            <!-- Left status icon -->
            <div class="tc-toast-icon">
              <svg v-if="toast.type === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="tc-toast-svg">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg v-else-if="toast.type === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="tc-toast-svg">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="tc-toast-svg">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <!-- Toast details -->
            <div class="tc-toast-content">
              <div class="tc-toast-title">{{ toast.title }}</div>
              <div v-if="toast.message" class="tc-toast-message">{{ toast.message }}</div>
            </div>

            <!-- Manual Close Button (×) -->
            <button class="tc-toast-close" @click="removeToast(toast.id)" title="Close notification">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="tc-close-svg">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <!-- Auto-dismiss Progress Bar -->
            <div class="tc-toast-timer-bar"></div>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tc-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-radius: 8px;
  font-family: 'Inter', system-ui, sans-serif;
  overflow: hidden;
}

/* ── Top Bar ─────────────────────────────────────────────────────────── */
.tc-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  gap: 8px;
}

.tc-sub-tabs {
  display: flex;
  gap: 4px;
}

.tc-sub-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tc-sub-tab:hover {
  background: #e2e8f0;
  color: #1e293b;
}

.tc-sub-tab--active {
  background: #ffffff;
  color: #ef5050;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.tc-tab-icon {
  width: 12px;
  height: 12px;
}

.tc-count-badge {
  background: #ef50501a;
  color: #ef5050;
  border-radius: 10px;
  padding: 1px 5px;
  font-size: 0.65rem;
  font-weight: 700;
}

.tc-actions {
  display: flex;
  align-items: center;
}

.tc-run-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: linear-gradient(135deg, #ef5050, #dc2626);
  color: #ffffff;
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 6px rgba(239, 80, 80, 0.3);
}

.tc-run-all-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  /* transform: translateY(-1px); */
}

.tc-run-all-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}

.tc-play-icon {
  width: 10px;
  height: 10px;
}

/* ── Toast Notifications (Top-Right Stacking) ────────────────────────── */
.tc-toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
  max-width: 360px;
  width: calc(100vw - 40px);
}

.tc-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 30px -6px rgba(15, 23, 42, 0.18), 0 4px 10px -2px rgba(15, 23, 42, 0.08);
  border: 1px solid #e2e8f0;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.tc-toast--success {
  border-left: 5px solid #10b981;
}

.tc-toast--success .tc-toast-icon {
  background: #ecfdf5;
  color: #059669;
}

.tc-toast--error {
  border-left: 5px solid #ef4444;
}

.tc-toast--error .tc-toast-icon {
  background: #fef2f2;
  color: #dc2626;
}

.tc-toast-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.tc-toast-svg {
  width: 15px;
  height: 15px;
}

.tc-toast-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 2px;
}

.tc-toast-title {
  font-size: 0.84rem;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.3;
}

.tc-toast-message {
  font-size: 0.74rem;
  color: #64748b;
  line-height: 1.4;
}

.tc-toast-close {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  margin-top: 2px;
}

.tc-toast-close:hover {
  color: #1e293b;
  background: #f1f5f9;
}

.tc-close-svg {
  width: 14px;
  height: 14px;
}

/* 3-Second Timer Countdown Bar */
.tc-toast-timer-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: #10b981;
  animation: tc-toast-timer 3s linear forwards;
}

.tc-toast--error .tc-toast-timer-bar {
  background: #ef4444;
}

@keyframes tc-toast-timer {
  from {
    width: 100%;
  }
  to {
    width: 0%;
  }
}

/* ── Vue Transition Animations ───────────────────────────────────────── */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(50px) scale(0.92);
}

.toast-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}

.toast-move {
  transition: transform 0.3s ease;
}

/* ── Body & Chips ────────────────────────────────────────────────────── */
.tc-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  gap: 8px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tc-body::-webkit-scrollbar {
  display: none;
}

.tc-chips-scroll {
  display: flex;
  gap: 5px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.tc-chips-scroll::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

.tc-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #475569;
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.tc-chip:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}

.tc-chip--selected {
  border-color: #ef5050;
  background: #fff5f5;
  color: #ef5050;
  font-weight: 700;
}

.tc-chip--passed {
  border-color: #10b981;
  color: #059669;
}

.tc-chip--failed {
  border-color: #ef4444;
  color: #dc2626;
}

.tc-chip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #94a3b8;
}

.tc-hidden-icon {
  font-size: 0.65rem;
}

/* ── Detail Card ─────────────────────────────────────────────────────── */
.tc-detail-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tc-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.tc-detail-title {
  display: flex;
  align-items: center;
  gap: 5px;
}

.tc-case-badge {
  font-size: 0.76rem;
  font-weight: 700;
  color: #1e293b;
}

.tc-badge-hidden {
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 0.62rem;
  font-weight: 600;
}

.tc-time-badge {
  font-size: 0.65rem;
  color: #64748b;
  font-weight: 600;
}

.tc-run-single-btn {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  color: #334155;
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tc-run-single-btn:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

/* ── Block & Code Box ────────────────────────────────────────────────── */
.tc-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tc-block-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.66rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tc-code-box {
  margin: 0;
  padding: 5px 8px;
  border-radius: 4px;
  background: #0f172a;
  color: #f8fafc;
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.72rem;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid #334155;
  max-height: 100px;
  overflow-y: auto;
}

.tc-code-box--passed {
  border-color: #10b981;
  background: #064e3b15;
  color: #065f46;
}

.tc-code-box--failed {
  border-color: #ef4444;
  background: #7f1d1d15;
  color: #991b1b;
}

.tc-badge-status {
  font-size: 0.62rem;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 800;
}

.tc-badge-status--passed {
  background: #10b98120;
  color: #059669;
}

.tc-badge-status--failed,
.tc-badge-status--error {
  background: #ef444420;
  color: #dc2626;
}

.tc-copy-btn {
  background: none;
  border: none;
  color: #3b82f6;
  font-size: 0.62rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.tc-copy-btn:hover {
  text-decoration: underline;
}

/* ── Hidden & Error Boxes ────────────────────────────────────────────── */
.tc-hidden-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  color: #475569;
  transition: all 0.2s ease;
}

.tc-lock-icon {
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  max-width: 16px;
  max-height: 16px;
  flex-shrink: 0;
  color: #94a3b8;
  margin-top: 2px;
}

.tc-hidden-box--passed {
  background: #ecfdf5;
  border: 1px solid #10b981;
}

.tc-hidden-box--passed .tc-lock-icon {
  color: #10b981;
}

.tc-hidden-box--failed,
.tc-hidden-box--error {
  background: #fef2f2;
  border: 1px solid #ef4444;
}

.tc-hidden-box--failed .tc-lock-icon,
.tc-hidden-box--error .tc-lock-icon {
  color: #ef4444;
}

.tc-hidden-content {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.tc-hidden-title {
  font-size: 0.78rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 2px;
}

.tc-hidden-desc {
  font-size: 0.72rem;
  color: #64748b;
  line-height: 1.4;
}

.tc-text-success {
  color: #059669;
}

.tc-text-danger {
  color: #dc2626;
}

.tc-error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  padding: 6px 8px;
  margin-top: 4px;
}

.tc-error-header {
  font-size: 0.64rem;
  font-weight: 700;
  color: #991b1b;
  margin-bottom: 2px;
}

.tc-error-pre {
  margin: 0;
  font-family: monospace;
  font-size: 0.68rem;
  color: #b91c1c;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── Custom Input Textarea ───────────────────────────────────────────── */
.tc-custom-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tc-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  font-family: 'Fira Code', monospace;
  font-size: 0.72rem;
  resize: vertical;
}

.tc-textarea:focus {
  outline: none;
  border-color: #ef5050;
}

/* ── Spinners ────────────────────────────────────────────────────────── */
.tc-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: tc-spin 0.6s linear infinite;
}

.tc-spinner-sm {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(0, 0, 0, 0.15);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: tc-spin 0.6s linear infinite;
  display: inline-block;
}

.tc-spinner-xs {
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(0, 0, 0, 0.2);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: tc-spin 0.6s linear infinite;
  display: inline-block;
}

@keyframes tc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
