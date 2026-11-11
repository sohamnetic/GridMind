import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/app/App'
import './styles/global.css'
import './styles/panels.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
