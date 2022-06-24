import Widget from './widget.svelte'

const el = document.getElementById('profile')
const dataset = el.dataset

const widget = new Widget({
  target: el,
  props: dataset
})