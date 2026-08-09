import { spawn } from 'child_process';
import os from 'os';

const isWin = os.platform() === 'win32';

console.log('[DevRunner] Starting Express backend (port 5000)...');
const backend = spawn('node', ['server/index.js'], { stdio: 'inherit', shell: true });

console.log('[DevRunner] Starting Vite frontend (port 3000)...');
const frontend = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--port', '3000', '--host', '0.0.0.0'], { stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});
