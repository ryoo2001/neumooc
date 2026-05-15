#!/usr/bin/env node
/**
 * neusoft-edu skill 前置检查
 * 自动发现 web-access skill 的 check-deps.mjs 并委托执行
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const HOME = os.homedir();

// 按优先级搜索 web-access skill 的位置
const SEARCH_PATHS = [
  path.join(HOME, '.agents', 'skills', 'web-access'),
  path.join(HOME, '.claude', 'skills', 'web-access'),
  // 兼容 Linux/macOS
  path.join(HOME, '.config', 'claude', 'skills', 'web-access'),
];

function findWebAccess() {
  for (const dir of SEARCH_PATHS) {
    const script = path.join(dir, 'scripts', 'check-deps.mjs');
    if (fs.existsSync(script)) return script;
  }
  return null;
}

const script = findWebAccess();

if (!script) {
  console.error('❌ 未找到 web-access skill，请先安装：');
  console.error('');
  console.error('  git clone https://github.com/eze-is/web-access.git ~/.agents/skills/web-access');
  console.error('');
  console.error('  或通过 Kiro 插件市场搜索 "web-access" 安装。');
  process.exit(1);
}

// 委托给 web-access 的 check-deps.mjs
const child = spawn(process.execPath, [script], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
