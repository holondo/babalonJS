import './style.css';
import { Editor } from './editor';
import { UI } from './ui';
import { locale } from './i18n';

document.documentElement.lang = locale();

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const editor = new Editor(canvas);
new UI(editor, document.querySelector<HTMLElement>('#app')!);

// Exposed for debugging from the browser console
Object.assign(window, { editor });
