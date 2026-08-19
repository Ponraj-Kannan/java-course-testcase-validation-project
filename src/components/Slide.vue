<template>
  <div class="slide-wrapper">
    <div class="navbar">
      <h2 class="navbar-title">{{ topic }}</h2>
      <img src="../assets/logo.png" />
    </div>

    <div class="slide-body">
      <div class="row-top">
        <div class="badge">{{ subTopic }}</div>
      </div>

      <div class="row-main">
        <!-- Editor Column -->
        <div class="col-editor">
          <slot
            name="editor"
            :code="editorCode"
            :language="editorLang"
            :set-code="(c) => (editorCode = c)"
          >
            <JavaRunner
              :language="language"
              :starter-code="starterCode"
              :code-key="codeKey"
              v-model:code="editorCode"
              @update:code="(c) => (editorCode = c)"
              @update:language="(l) => (editorLang = l)"
            />
          </slot>
        </div>

        <!-- Sidebar Column -->
        <div class="col-sidebar">
          <!-- Tabbed Header (when test cases are present) -->
          <div v-if="testCases && testCases.length > 0" class="sidebar-tabs">
            <button
              class="sidebar-tab"
              :class="{ 'sidebar-tab--active': sidebarTab === 'problem' }"
              @click="sidebarTab = 'problem'"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Problem
            </button>

            <button
              class="sidebar-tab"
              :class="{ 'sidebar-tab--active': sidebarTab === 'testcases' }"
              @click="sidebarTab = 'testcases'"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              Test Cases
              <span class="tab-badge">{{ testCases.length }}</span>
            </button>
          </div>

          <!-- Problem View (Always visible on load, no v-click hiding) -->
          <div v-show="!testCases || testCases.length === 0 || sidebarTab === 'problem'" class="problem-content">
            <template v-for="(item, index) in contents" :key="index">
              <div v-if="item.codeEditor" class="code-card">
                <div class="code-card__lang">{{ item.lang ?? 'text' }}</div>
                <pre class="code-card__pre"><code>{{ item.text }}</code></pre>
              </div>

              <div
                v-else
                class="info-card"
                :class="{ 'info-card--highlight': item.highlight }"
                v-html="item.text"
              />

              <br v-if="!item.codeEditor" />
            </template>

            <slot name="sidebar" />
          </div>

          <!-- Test Cases View -->
          <div v-if="testCases && testCases.length > 0" v-show="sidebarTab === 'testcases'" class="testcases-content">
            <TestCaseRunner
              :test-cases="testCases"
              :code="editorCode"
              :language="editorLang"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import JavaRunner from './JavaRunner.vue'
import TestCaseRunner from './TestCaseRunner.vue'

const props = defineProps({
  topic: {
    type: String,
    required: true,
  },
  subTopic: {
    type: String,
    default: '',
  },
  contents: {
    type: Array,
    default: () => [],
  },
  testCases: {
    type: Array,
    default: () => [],
  },
  language: {
    type: String,
    default: 'java',
  },
  starterCode: {
    type: String,
    default: '',
  },
  codeKey: {
    type: String,
    default: '',
  },
});

const sidebarTab = ref('problem');
const editorCode = ref(props.starterCode || '');
const editorLang = ref(props.language || 'java');
</script>

<style scoped>
.slide-wrapper {
  margin-top: -10px;
  margin-left: -30px;
  width: 107%;
  height: 94%;
  font-size: 0.8rem;
  font-weight: 400;
}

.slide-body {
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  margin-top: 36px;
  height: 100%;
  width: 100%;
}

.navbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0 10px;
  color: #ffffff;
  position: fixed;
  width: 94.7%;
  background-color: #ffffff;
  margin-top: -36px;
}

.navbar > img {
  height: 30px;
}

.navbar-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  background-color: #ef5050;
  color: #ffffff;
  width: 80%;
  padding-left: 10px;
  margin-left: -10px;
  border-radius: 5px;
}

.row-top {
  width: 100%;
  height: 4.5vh;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.row-main {
  width: 100%;
  height: 87%;
  display: flex;
  flex-direction: row;
  margin-top: 10px;
}

.col-editor {
  width: 65%;
  height: 100%;
}

.col-sidebar {
  width: 35%;
  height: 100%;
  padding: 0 10px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  display: flex;
  flex-direction: column;
}

.col-sidebar::-webkit-scrollbar {
  display: none;
}

/* ── Sidebar Tabs ────────────────────────────────────────────────────── */
.sidebar-tabs {
  display: flex;
  gap: 6px;
  background: #f1f5f9;
  padding: 3px;
  border-radius: 6px;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.sidebar-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 8px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-tab:hover {
  color: #1e293b;
}

.sidebar-tab--active {
  background: #ffffff;
  color: #ef5050;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.tab-icon {
  width: 13px;
  height: 13px;
}

.tab-badge {
  background: #ef50501a;
  color: #ef5050;
  border-radius: 10px;
  padding: 0 5px;
  font-size: 0.65rem;
  font-weight: 700;
}

.problem-content {
  flex: 1;
  overflow-y: auto;
}

.testcases-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.badge {
  border-radius: 4px;
  font-size: 1rem;
  display: inline-block;
  min-width: 32px;
  padding: 5px 10px;
  background-color: #ef50505a;
  border: 1px solid #ef5050;
  margin-top: 10px;
}

.info-card {
  border-radius: 4px;
  font-size: 0.9rem;
  color: #374151;
  background-color: #e2f0fe;
  border: 1px solid #a9c4d2;
  display: inline-block;
  min-width: 32px;
  padding: 8px 10px;
  width: 100%;
  margin-bottom: 8px;
  box-sizing: border-box;
  line-height: 1.5;
}

.info-card--highlight {
  background-color: #6fcf9745;
  border: 1px solid #1f6f5fa7;
  text-align: center;
}

.code-card {
  border-radius: 4px;
  border: 1px solid #334155;
  background-color: #0f172a;
  overflow: hidden;
  width: 100%;
  margin-bottom: 8px;
  box-sizing: border-box;
}

.code-card__lang {
  background-color: #1e293b;
  color: #94a3b8;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-bottom: 1px solid #334155;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.code-card__pre {
  margin: 0;
  padding: 8px 10px;
  overflow-x: auto;
  font-family: 'Fira Code', 'Cascadia Code', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #e2e8f0;
  white-space: pre;
}
</style>