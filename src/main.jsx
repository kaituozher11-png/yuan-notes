import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import './style.css';
import 'katex/dist/katex.min.css';
createRoot(document.getElementById('root')).render(<AuthGate App={App} />);

if (import.meta.env.PROD && !window.YuanOfflineApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app remains usable in browsers that block service workers.
    });
  });
}
