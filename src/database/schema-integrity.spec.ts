import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './schema';

const schemasDirectory = resolve(process.cwd(), 'src/database/schemas');
const schemaFiles = readdirSync(schemasDirectory).filter((name) =>
  name.endsWith('.ts'),
);
const schemaExports = readFileSync(
  resolve(process.cwd(), 'src/database/schema.ts'),
  'utf8',
);

describe('integridade das definições Drizzle', () => {
  it('mantém uma tabela por arquivo e exporta todas para a API', () => {
    const exportedTables = Object.values(schema).map(
      (table) => getTableConfig(table).name,
    );
    expect(exportedTables).toHaveLength(schemaFiles.length);
    expect(new Set(exportedTables).size).toBe(exportedTables.length);

    for (const file of schemaFiles) {
      const source = readFileSync(resolve(schemasDirectory, file), 'utf8');
      const tableNames = Array.from(source.matchAll(/pgTable\(\s*'([^']+)'/g));
      expect(tableNames).toHaveLength(1);
      const tableName = file.replace(/\.ts$/, '');
      expect(tableNames[0][1]).toBe(tableName);
      expect(exportedTables).toContain(tableName);
      expect(schemaExports).toContain(
        `export * from './schemas/${tableName}';`,
      );
    }
  });

  it('usa nomes de foreign keys únicos e dentro do limite do PostgreSQL', () => {
    const names = Object.values(schema).flatMap((table) =>
      getTableConfig(table).foreignKeys.map((key) => key.getName()),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(63);
    }
  });
});
