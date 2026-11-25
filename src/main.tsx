import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AiAssistantPopoutRoot} from './components/AiAssistantPopoutRoot.tsx';
import {isAiAssistantPopoutRoute} from './services/aiAssistantSync.ts';
import './index.css';

const isAiPopout = isAiAssistantPopoutRoute();
createRoot(document.getElementById('root')!).render(isAiPopout ? <AiAssistantPopoutRoot /> : <App />);
