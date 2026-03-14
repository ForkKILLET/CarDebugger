<script setup lang="ts" generic="T">
import { ref } from 'vue'

const props = defineProps<{
  promise: Promise<T>
}>()

type State =
  | { type: 'pending' }
  | { type: 'fulfilled', value: T }
  | { type: 'rejected', reason: any }

const state = ref<State>({ type: 'pending' })

props.promise
  .then(value => {
    state.value = { type: 'fulfilled', value }
  })
  .catch(reason => {
    state.value = { type: 'rejected', reason }
  })
</script>

<template>
  <slot v-if="state.type === 'pending'" name="pending">Loading...</slot>
  <slot v-else-if="state.type === 'fulfilled'" name="fulfilled" :value="state.value"></slot>
  <slot v-else-if="state.type === 'rejected'" name="rejected" :reason="state.reason">
    <pre class="await-rejected">{{ state.reason?.['message'] ?? state.reason }}</pre>
  </slot>
</template>