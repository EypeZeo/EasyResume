import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';

const result = spawnSync('uv', ['run', 'python', 'scripts/export_openapi.py'], {
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
if (result.status !== 0) throw new Error(result.stderr || 'OpenAPI export failed');
const schema = JSON.parse(result.stdout);
const source = astToString(await openapiTS(schema));
await mkdir('apps/workbench/src/generated', { recursive: true });
await writeFile('apps/workbench/src/generated/api.ts', source);
console.log('Generated API contract from FastAPI OpenAPI (no user data).');
