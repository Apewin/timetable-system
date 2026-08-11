import { basename, resolve } from 'node:path';

export function materializeExport(result, outputDir, { mkdir, writeFile }) {
  const sourceFiles = result?.data?.files;
  if (!Array.isArray(sourceFiles) || !sourceFiles.length) throw new Error('后端没有返回可写入的课表文件');
  mkdir(outputDir, { recursive: true });
  const usedNames = new Set();
  const files = sourceFiles.map(file => {
    const filename = basename(file.filename || `${file.kind || 'timetable'}.xlsx`);
    if (!filename || usedNames.has(filename)) throw new Error(`导出文件名无效或重复: ${filename || '(空)'}`);
    if (typeof file.data_base64 !== 'string' || !file.data_base64) throw new Error(`导出文件缺少内容: ${filename}`);
    usedNames.add(filename);
    const outputPath = resolve(outputDir, filename);
    writeFile(outputPath, Buffer.from(file.data_base64, 'base64'));
    return { kind: file.kind, filename, mime_type: file.mime_type, path: outputPath };
  });
  return {
    ...result,
    data: {
      summary: result.data?.summary,
      template_sources: result.data?.template_sources,
      files,
    },
  };
}
