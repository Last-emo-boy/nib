import { createRoot } from 'react-dom/client';
import './styles.css';
import { store } from './app/store.ts';
import { App } from './ui/App.tsx';
import { detectSite, site } from './web/mode.ts';

// The app's and daemon's editor, or nib's website (documents kept in the browser): the config says which.
await detectSite();
store.set({ web: site.web });
createRoot(document.getElementById('root')!).render(<App />);
