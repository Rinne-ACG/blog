import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { supabase } from './lib/supabase'

(window as any).supabase = supabase

createRoot(document.getElementById('root')!).render(<App />)
