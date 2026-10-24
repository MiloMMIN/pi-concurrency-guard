import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const releaseType = process.argv[2] || 'patch'; // patch, minor, major

function run(cmd, desc) {
  console.log(`\n▶ [${desc}] ${cmd}`);
  try {
    execSync(cmd, { cwd: projectRoot, stdio: 'inherit' });
  } catch (err) {
    console.error(`\n❌ [失败] 执行步骤 "${desc}" 出错，流程已安全中止。`);
    process.exit(1);
  }
}

console.log(`🚀 [Pi Concurrency Guard] 开始自动化构建与全渠道同步 (模式: ${releaseType})...`);

// 1. 本地编译与类型检查
run('npm run build', '编译 TypeScript 源码到 dist/');

// 2. 升级版本号
const pkgPath = path.join(projectRoot, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const currentVersion = pkg.version;

// 使用 npm version 计算下一个版本
const nextVersionOutput = execSync(`npm version ${releaseType} --no-git-tag-version`, { cwd: projectRoot, encoding: 'utf-8' }).trim();
const newVersion = nextVersionOutput.replace(/^v/, '');
console.log(`\n📌 版本流转: v${currentVersion} ➔ v${newVersion}`);

// 3. Git 暂存与提交
run('git add -A', '暂存所有源码改动与编译产物');
try {
  run(`git commit -m "chore(release): v${newVersion}"`, `提交 Git Release: v${newVersion}`);
} catch {
  console.log('ℹ️ 没有新的代码变动需要提交，继续推进 Tag 与发布...');
}

// 4. Git 标签
run(`git tag -a v${newVersion} -m "Release v${newVersion}"`, `打 Git Tag: v${newVersion}`);

// 5. 推送到 GitHub
run('git push origin main --tags', '推送代码与 Tags 到 GitHub 远程仓库');

// 6. 发布到 npm 官方源
run('npm publish --access public --registry=https://registry.npmjs.org/', '发布最新包到 npm 官方源');

// 7. 汇报总结
console.log('\n======================================================');
console.log(`🎉 [成功] pi-concurrency-guard v${newVersion} 已完成全渠道同步闭环！`);
console.log(`- GitHub: https://github.com/MiloMMIN/pi-concurrency-guard/releases/tag/v${newVersion}`);
console.log(`- npm 官方包: https://www.npmjs.com/package/pi-concurrency-guard/v/${newVersion}`);
console.log(`- 本地软链接: 已实时热更新至最新 dist/ 产物`);
console.log('======================================================\n');
