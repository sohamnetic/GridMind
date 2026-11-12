import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/app/App'
import '@fontsource/titillium-web/latin-400.css'
import '@fontsource/titillium-web/latin-600.css'
import '@fontsource/titillium-web/latin-700.css'
import '@fontsource/titillium-web/latin-700-italic.css'
import './styles/global.css'
import './styles/panels.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
