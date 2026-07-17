import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const android = resolve(root, 'android')
const windows = process.platform === 'win32'
const executable = windows ? 'gradlew.bat' : './gradlew'
const result = spawnSync(executable, ['assembleDebug'], {
  cwd: android,
  stdio: 'inherit',
  shell: windows
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
