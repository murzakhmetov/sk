import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installDebugHooks } from './game/debug';
import './index.css';

if (import.meta.env.DEV) installDebugHooks();

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
