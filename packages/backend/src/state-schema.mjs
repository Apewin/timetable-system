export const CURRENT_STATE_SCHEMA_VERSION = 1;

const MIGRATIONS = new Map([
  [0, state => ({
    ...state,
    schema_version: 1,
    meta: {
      ...(state.meta || {}),
      revision: Number.isSafeInteger(Number(state.meta?.revision))
        ? Number(state.meta.revision)
        : 0,
    },
  })],
]);

function schemaVersion(document) {
  if (document?.schema_version === undefined) return 0;
  const version = Number(document.schema_version);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('状态文件 schema_version 必须是非负整数');
  }
  return version;
}

export function migrateStateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('状态文件根节点必须是对象');
  }
  const migratedFrom = schemaVersion(document);
  if (migratedFrom > CURRENT_STATE_SCHEMA_VERSION) {
    throw new Error(
      `状态文件 schema_version=${migratedFrom} 高于当前程序支持的 ${CURRENT_STATE_SCHEMA_VERSION}；请先升级程序`,
    );
  }
  let state = structuredClone(document);
  let version = migratedFrom;
  while (version < CURRENT_STATE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS.get(version);
    if (!migrate) throw new Error(`缺少从 schema_version=${version} 开始的状态迁移`);
    state = migrate(state);
    version = schemaVersion(state);
  }
  return { state, migrated_from: migratedFrom, schema_version: version };
}

export function stateDocumentForWrite(document) {
  const { state } = migrateStateDocument(document);
  return { ...state, schema_version: CURRENT_STATE_SCHEMA_VERSION };
}
