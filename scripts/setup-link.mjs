import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const piExtensionsDir = path.join(os.homedir(), '.pi', 'agent', 'extensions');
const linkPath = path.join(piExtensionsDir, 'pi-concurrency-guard');

console.log('🔗 [Pi Concurrency Guard] 检查并配置本地开发软链接...');

// 确保 dist 存在
if (!fs.existsSync(distPath)) {
  console.log('📦 正在执行首次编译 build...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
}

// 确保 extensions 目录存在
if (!fs.existsSync(piExtensionsDir)) {
  fs.mkdirSync(piExtensionsDir, { recursive: true });
}

// 检查现有链接
if (fs.existsSync(linkPath)) {
  console.log(`✅ 本地软链接已存在: ${linkPath} -> ${distPath}`);
} else {
  try {
    if (os.platform() === 'win32') {
      execSync(`powershell -NoProfile -Command "New-Item -ItemType Junction -Path '${linkPath}' -Target '${distPath}'"`, { stdio: 'inherit' });
    } else {
      fs.symlinkSync(distPath, linkPath, 'dir');
    }
    console.log(`🎉 软链接配置成功! ${linkPath} -> ${distPath}`);
  } catch (err) {
    console.error('❌ 配置软链接失败:', err);
    process.exit(1);
  }
}
