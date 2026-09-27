import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Prevent mouse wheel from inadvertently changing values in number inputs
if (typeof window !== 'undefined') {
  document.addEventListener('wheel', (e) => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number') {
      e.target.blur();
    }
  }, { passive: true });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
