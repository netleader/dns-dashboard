import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { t } from './lib/i18n';
import './styles/theme.css';

document.title = t('app.title');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
