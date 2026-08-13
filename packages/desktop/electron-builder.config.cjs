const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..', '..');
const solverExecutable = resolve(__dirname, 'solver-dist', 'timetable-solver.exe');
const extraResources = [
  {
    from: resolve(__dirname, 'seed-state.json'),
    to: 'seed-state.json',
  },
];
if (existsSync(solverExecutable)) {
  extraResources.push({
    from: solverExecutable,
    to: 'solver/timetable-solver.exe',
  });
}

module.exports = {
  appId: 'net.apewin.timetable',
  productName: 'AP排课系统',
  artifactName: 'AP-Timetable-${version}-${arch}-Setup.${ext}',
  asar: false,
  npmRebuild: false,
  directories: {
    output: resolve(projectRoot, 'release'),
  },
  files: [
    'package.json',
    'packages/backend/package.json',
    'packages/backend/src/**/*',
    'packages/backend/assets/**/*',
    'packages/cli/src/**/*',
    'packages/web/dist/**/*',
    'packages/desktop/main.mjs',
    'packages/desktop/runtime.mjs',
    'node_modules/**/*',
    '!node_modules/.cache/**/*',
    '!**/test{,s}/**/*',
  ],
  extraResources,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'AP排课系统',
  },
};
