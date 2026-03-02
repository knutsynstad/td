import './style.css';
import { bootstrapGame } from './bootstrap';

const app = document.querySelector<HTMLDivElement>('#app')!;
void bootstrapGame(app);
