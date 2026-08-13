import { constants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function ensureUserState({ stateFile, seedFile }) {
  if (await exists(stateFile)) return { created: false, stateFile };
  await mkdir(dirname(stateFile), { recursive: true });
  try {
    await copyFile(seedFile, stateFile, constants.COPYFILE_EXCL);
    return { created: true, stateFile };
  } catch (error) {
    if (error?.code === 'EEXIST') return { created: false, stateFile };
    throw error;
  }
}

export function serverUrl(address) {
  const port = Number(address?.port);
  if (!Number.isInteger(port) || port <= 0) throw new Error('桌面后端没有返回有效端口');
  return `http://127.0.0.1:${port}/`;
}
