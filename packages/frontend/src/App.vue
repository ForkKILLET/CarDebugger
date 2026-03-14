<script setup lang="ts">
import type { z } from 'zod'
import axios, { AxiosError } from 'axios'
import {
  parseAnsiSequences, type ParseToken as AnsiParseToken, type Color as AnsiColor,
  type ColorName
} from 'ansi-sequence-parser'

import { computed, nextTick, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import Await from './components/Await.vue'

import { Api, Dataset, Session, CompileRes, ElementDisplay, ELEMENT_DISPLAY } from '@car-debugger/shared'
import { storeReactive } from './utils/storage'
import { useEventListener } from '@vueuse/core'

const WIDTH = 188
const HEIGHT = 120
const Y_INSET = 35
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `//${location.hostname}:1660`
const OFFSET_HISTORY_SIZE = 15

const http = axios.create({
  baseURL: BACKEND_URL,
})

const api = async <P extends keyof typeof Api>(path: P, body: z.infer<Api[P]['req']>): Promise<z.infer<Api[P]['res']>> => {
  try {
    const { data } = await http({
      method: Api[path].method,
      responseType: 'json',
      url: path,
      data: body,
    })
    return data
  }
  catch (err) {
    if ((err as AxiosError).status === 403) {
      session.value = null
    }
    throw err
  }
}

const session = storeReactive<{ value: Session | null }>('session', { value: null })
const datasetName = ref<string | null>(session.value?.datasetName ?? null)
const datasetList = ref<Dataset[] | null>(null)
const dataset = computed(() => {
  if (! datasetList.value) return null
  const name = datasetName.value
  return datasetList.value.find(dataset => dataset.name === name)
})

const getDatasetList = async () => {
  return datasetList.value = await api('/dataset-list', {})
}

const createSession = async () => {
  session.value = await api('/create-session', {
    datasetName: datasetName.value!,
  })
  await runFrame()
}
const deleteSession = async () => {
  if (! session.value) return
  const { id } = session.value
  await api('/delete-session', { id })
  session.value = null
}

const taskGetDataList = ref<ReturnType<typeof getDatasetList> | null>(null)
const taskCreateSession = ref<ReturnType<typeof createSession> | null>(null)

const cellWidth = ref(3)
const cellHeight = ref(3)

const isAutoPlaying = ref(false)
const interval = ref(50)

const speedUp = () => {
  if (interval.value > 50) interval.value -= 50
}
const speedDown = () => {
  if (interval.value < 2000) interval.value += 50
}

const autoPlay = async () => {
  if (isAutoPlaying.value) await runNext()
  setTimeout(autoPlay, interval.value)
}

const debugOutput = ref<string | null>(null)
const imageOutput = ref<AnsiParseToken[][] | null>(null)
const frameError = ref<string | null>(null)
const dataOutput = ref<string | null>(null)
const history = reactive<{ frameIndex: number, offset: number }[]>([])
const isLoadingFrame = ref(false)
const loadedFrameIndex = ref(1)
const loadedFrameBackground = computed(() =>
  session.value
    ? `url(${BACKEND_URL}/dataset-image/${session.value.datasetName}/${loadedFrameIndex.value})`
    : undefined
)
const loadingTime = ref(0)
const compileResult = ref<CompileRes | null>(null)

const DISPLAY_MODES = [ 'both', 'image', 'text' ] as const
const displayMode = ref<typeof DISPLAY_MODES[number]>(DISPLAY_MODES[0])
const nextDisplayMode = () => {
  const index = DISPLAY_MODES.indexOf(displayMode.value)
  displayMode.value = DISPLAY_MODES[(index + 1) % DISPLAY_MODES.length]
}

const canvas = useTemplateRef('canvas')

const runFrame = async ({
  doNotClearCompileResult = false,
}: {
  doNotClearCompileResult?: boolean
} = {}) => {
  const sess = session.value
  if (! sess) return

  if (history[0]?.frameIndex === sess.frameIndex) history.shift()

  if (compileResult.value && ! doNotClearCompileResult) {
    compileResult.value = null
  }

  if (isLoadingFrame.value) return

  isLoadingFrame.value = true
  const startTime = Date.now()
  try {
    const { id, frameIndex } = sess
    const result = await api('/run-frame', {
      id,
      frameIndex,
    })
    if (result.status === 'failure') {
      debugOutput.value = imageOutput.value = null
      frameError.value = result.reason
      isLoadingFrame.value = false
      return
    }
    const { stdout, stderr } = result.value
    const [ debugStr, imageStr ] = stdout.split('\x1B[2J\x1B[H')
    debugOutput.value = debugStr
    imageOutput.value = imageStr
      .trim()
      .split('\n')
      .map(line => parseAnsiSequences(line.slice(4)))
    frameError.value = null

    const dataStr = dataOutput.value = stderr
    const offset = + dataStr.match(/\[offset = (.+?)\]/)![1]
    history.unshift({ frameIndex, offset })
    if (history.length > OFFSET_HISTORY_SIZE) history.pop()

    loadedFrameIndex.value = frameIndex
  }
  finally {
    isLoadingFrame.value = false
    loadingTime.value = Date.now() - startTime
  }
}

const runNext = async () => {
  const sess = session.value
  if (! sess) return
  const { size } = dataset.value!
  sess.frameIndex = (sess.frameIndex + 1) % size

  await runFrame()
}

const runPrev = async () => {
  const sess = session.value
  if (! sess) return
  if (history[0]?.frameIndex === sess.frameIndex) history.shift()
  const { size } = dataset.value!
  sess.frameIndex = (sess.frameIndex - 1 + size) % size

  await runFrame()
}

const compile = async () => {
  const sess = session.value
  if (! sess) return

  const { id } = sess
  const result = compileResult.value = await api('/compile', { id })
  if (result.status === 'success') {
    await runFrame({ doNotClearCompileResult: true })
  }
  else {
    imageOutput.value = null
  }
}

const setElement = async () => {
  const sess = session.value
  if (! sess) return
  if (! element.value) return

  const { id } = sess
  await api('/set-element', { id, element: element.value })

  await runFrame()
}

const COLOR_MAP: Record<ColorName, string> = {
  black: '#000000',
  red: '#FF0000',
  green: '#00FF00',
  yellow: '#FFFF00',
  blue: '#0000FF',
  magenta: '#FF00FF',
  cyan: '#00FFFF',
  white: '#FFFFFF',
  brightBlack: '#808080',
  brightRed: '#FF5555',
  brightGreen: '#50FA7B',
  brightYellow: '#F1FA8C',
  brightBlue: '#BD93F9',
  brightMagenta: '#FF79C6',
  brightCyan: '#8BE9FD',
  brightWhite: '#FFFFFF',
}

const OPACITY = '55'
const MINOR_COLOR_NAMES = [ 'black', 'white' ]

const getColor = (color: AnsiColor | null, x: number, y: number): string | undefined => {
  if (! color) return undefined
  if (color.type === 'rgb') {
    const [ r, g, b ] = color.rgb
    return `rgb(${r}, ${g}, ${b})`
  }
  else if (color.type === 'named') {
    const hex = COLOR_MAP[color.name]
    if (MINOR_COLOR_NAMES.includes(color.name)) {
      if (lineXs[x] || lineYs[y]) return COLOR_MAP.brightMagenta
      return hex + OPACITY
    }
    return hex
  }
}

const lineX = ref<number | null>(null)
const lineY = ref<number | null>(null)
const lineXs = reactive<Record<number, boolean>>({})
const lineYs = reactive<Record<number, boolean>>({})
const toggleLineX = () => {
  if (lineX.value === null) return
  lineXs[lineX.value] = ! lineXs[lineX.value]
}
const toggleLineY = () => {
  if (lineY.value === null) return
  lineYs[lineY.value] = ! lineYs[lineY.value]
}

onMounted(async () => {
  taskGetDataList.value = getDatasetList()
  autoPlay()
})

const element = ref<ElementDisplay | null>(null)

const progressEl = useTemplateRef('progress')
const progressIndex = ref<number | null>(null)
useEventListener('mousemove', ev => {
  if (! progressEl.value) return
  const rect = progressEl.value.getBoundingClientRect()
  const x = ev.clientX - rect.left
  const y = ev.clientY - rect.top
  const { width, height } = rect
  progressIndex.value = x >= 0 && x < width && y >= 0 && y <= height
    ? Math.floor((x / width) * dataset.value!.size) + 1
    : null
})

const gotoProgress = () => {
  if (progressIndex.value === null) return
  session.value!.frameIndex = progressIndex.value
  runFrame()
}

watch(
  [ imageOutput, displayMode, cellWidth, cellHeight, lineXs, lineYs ],
  async ([ matrix, _, cw, ch ]) => {
    if (! canvas.value || ! matrix) return
    await nextTick()

    const ctx = canvas.value.getContext('2d')!
    ctx.resetTransform()
    ctx.scale(cw, ch)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    if (displayMode.value === 'image') return

    for (const [ y0, row ] of matrix.entries()) {
      const y = y0 + Y_INSET
      for (const [ x, cell ] of row.entries()) {
        const color = getColor(cell.background, x, y)
        if (color) ctx.fillStyle = color
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
)

watch(() => !! session, async (hasSession) => {
  if (hasSession) await runFrame()
}, { immediate: true })

useEventListener('beforeunload', async () => {
  await deleteSession()
})

useEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.key === 'ArrowLeft') runPrev()
  else if (ev.key === 'ArrowRight') runNext()
  else if (ev.key === ' ') {
    ev.preventDefault()
    isAutoPlaying.value = ! isAutoPlaying.value
  }
  else if (ev.key === 'Enter') {
    ev.preventDefault()
    runFrame()
  }
  else if (ev.key === 'c') {
    compile()
  }
})
</script>

<template>
  <div class="session-state">
    <header>
      <Await v-if="taskGetDataList" :promise="taskGetDataList">
        <template #pending>
          Loading dataset index...
        </template>
        <template #fulfilled="{ value: datasetIndex }">
          <div class="flex">
            <span>
              Dataset:
              <select v-model="datasetName">
                <option v-for="{ name } of datasetIndex" :value="name">{{ name }}</option>
              </select>
            </span>
            <button
              v-if="! session.value"
              :disabled="! datasetName"
              @click="taskCreateSession = createSession()"
            >Start debugging</button>
            <button v-else @click="deleteSession">Exit</button>
          </div>
        </template>
      </Await>

      <Await v-if="taskCreateSession" :promise="taskCreateSession">
        <template #pending>
          Connecting to {{ BACKEND_URL }}...
        </template>
      </Await>
    </header>

    <main v-if="session.value">
      <div class="flex control-buttons">
        <button :disabled="isLoadingFrame" @click="runPrev">&lt;</button>
        <input :disabled="isLoadingFrame" type="number" v-model="session.value.frameIndex" />
        <button :disabled="isLoadingFrame" @click="runFrame()">@</button>
        <button :disabled="isLoadingFrame" @click="compile">C</button>
        <button @click="isAutoPlaying = ! isAutoPlaying">{{ isAutoPlaying ? '||' : '|>' }}</button>
        <button :disabled="isLoadingFrame" @click="runNext">&gt;</button>
        <button @click="speedUp">S+</button>
        <button @click="speedDown">S-</button>
        <button @click="cellWidth ++">W+</button>
        <button @click="cellWidth --">W-</button>
        <button @click="cellHeight ++">H+</button>
        <button @click="cellHeight --">H-</button>
      </div>
      <div class="flex control-buttons">
        <button @click="nextDisplayMode">{{ displayMode[0] }}</button>
        <input type="number" v-model="lineX" />
        <button @click="toggleLineX">LX</button>
        <input type="number" v-model="lineY" />
        <button @click="toggleLineY">LY</button>
        <select v-model="element">
          <option v-for="el of ELEMENT_DISPLAY" :value="el">{{ el }}</option>
        </select>
        <button @click="setElement">EL</button>
      </div>

      <div class="result flex">
        <div class="box image-output">
          <canvas
            :width="WIDTH * cellWidth"
            :height="HEIGHT * cellHeight"
            :style="{
              backgroundImage: displayMode === 'text'
                ? undefined
                : loadedFrameBackground
            }"
            ref="canvas"
          ></canvas>
          <div
            class="progress"
            ref="progress"
            @click="gotoProgress"
          >
            <template v-if="dataset">
              <div
                v-if="progressIndex !== null"
                class="progress-tooltip"
                :style="{
                  left: `${(progressIndex / dataset.size) * 100}%`
                }"
              >{{ progressIndex }}</div>
              <div
                class="progress-inner" 
                :style="{
                  width: `${(loadedFrameIndex / dataset.size) * 100}%`,
                }"
              ></div>
            </template>
          </div>
        </div>

        <div v-if="frameError !== null" class="box">
          <pre>Error: {{ frameError }}</pre>
        </div>

        <div class="box data-output">
          <pre>{{ dataOutput }}</pre>
          <br />
          <pre>[loading time = {{ loadingTime }} ms]</pre>
          <template v-if="compileResult">
            <pre v-if="compileResult.status === 'success'">[compile OK]</pre>
            <template v-else>
              <pre>[compile ERR]</pre>
              <pre>{{ compileResult.reason }}</pre>
            </template>
          </template>
        </div>

        <div class="box">
          <svg width="300" height="250" class="chart">
            <template v-for="{ offset }, i of history">
              <rect
                :x="offset < 0 ? 100 + offset * 2 : 100"
                :y="10 + i * 15"
                :width="Math.abs(offset) * 2"
                :height="5"
              ></rect>
              <text
                :x="210"
                :y="14 + i * 15"
              >{{ offset.toFixed(2) }}</text>
            </template>
          </svg>
        </div>

        <div v-if="debugOutput" class="box">
          <pre>{{ debugOutput }}</pre>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
main {
  margin: 1rem 0;
}

.box {
  border: 1px solid #000;
  width: fit-content;
  padding: .5rem;
  margin: .5rem 0;
}

.image-output {
  line-height: 0;
}

.image-output > canvas {
  background-size: 100% 100%;
}

.progress {
  position: relative;
  width: 100%;
  height: .5rem;
  cursor: crosshair;
}

.progress-tooltip {
  position: absolute;
  top: 1rem;
  width: 2rem;
  margin-left: -1rem;
  padding-bottom: .2rem;
  line-height: 1;
  border: 1px solid black;
  background-color: white;
  text-align: center;
  z-index: 1;
}

.progress-inner {
  height: 100%;
  background-color: blue;
}

.data-output {
  min-width: 15rem;
}

.control-buttons {
  margin: .25rem 0;
  align-items: center;
}

.control-buttons > input, .control-buttons > select {
  width: 3rem;
  height: 2rem;
  box-sizing: border-box;
}

.control-buttons > select {
  width: 8.5rem;
}

.control-buttons > button {
  flex-shrink: 0;
  white-space: nowrap;
  height: 2rem;
  width: 2rem;
  font-family: monospace;
}

pre {
  margin: 0;
}

.result {
  flex-wrap: wrap;
  align-items: flex-start;
}

.chart rect {
  dominant-baseline: middle;
  fill: #0000FF;
}

.chart rect:first-child {
  fill: #00FFFF
}

.chart text {
  dominant-baseline: middle;
  font-family: monospace;
}
</style>
