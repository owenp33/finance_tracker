import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CategoryColorProvider } from './CategoryColorContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <CategoryColorProvider>
      <App />
    </CategoryColorProvider>
  </React.StrictMode>
);