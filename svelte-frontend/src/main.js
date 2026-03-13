import './app.css'
import 'highlight.js/styles/github-dark-dimmed.min.css'
import App from './App.svelte'
import { mount } from 'svelte'
import { initTheme } from './stores/theme.svelte.js'

initTheme()

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
