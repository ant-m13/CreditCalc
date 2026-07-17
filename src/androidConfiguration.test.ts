// @vitest-environment node
// @ts-expect-error -- Vitest выполняет этот тест в Node.js; основной tsconfig намеренно не включает @types/node.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRepositoryFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = readRepositoryFile('android/app/src/main/AndroidManifest.xml')
const appGradle = readRepositoryFile('android/app/build.gradle')
const rootGradle = readRepositoryFile('android/build.gradle')
const capacitorConfig = readRepositoryFile('capacitor.config.ts')
const releaseWorkflow = readRepositoryFile('.github/workflows/android-release.yml')
const autoReleaseWorkflow = readRepositoryFile('.github/workflows/auto-release.yml')
const fileProviderPaths = readRepositoryFile('android/app/src/main/res/xml/file_paths.xml')
const mainActivity = readRepositoryFile('android/app/src/main/java/io/github/antm13/creditcalc/MainActivity.java')
const androidPrintPlugin = readRepositoryFile('android/app/src/main/java/io/github/antm13/creditcalc/AndroidPrintPlugin.java')

describe('Android configuration', () => {
  it('фиксирует неизменяемый application ID и отдельную нативную сборку', () => {
    expect(capacitorConfig).toContain("appId: 'io.github.antm13.creditcalc'")
    expect(capacitorConfig).toContain("appName: 'CreditCalc'")
    expect(capacitorConfig).toContain("webDir: 'dist-android'")
    expect(capacitorConfig).toContain("insetsHandling: 'css'")
    expect(appGradle).toContain('applicationId "io.github.antm13.creditcalc"')
  })

  it('связывает Android versionName и versionCode с SemVer package.json', () => {
    expect(appGradle).toContain("new JsonSlurper().parse(file('../../package.json'))")
    expect(appGradle).toContain('versionCode semanticVersionCode')
    expect(appGradle).toContain('versionName semanticVersion')
  })

  it('не включает сеть, backup, Google Services или cleartext', () => {
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:usesCleartextTraffic="false"')
    expect(manifest).not.toContain('android.permission.INTERNET')
    expect(rootGradle).not.toContain('com.google.gms:google-services')
    expect(appGradle).not.toContain('google-services.json')
    expect(fileProviderPaths).toContain('<cache-path name="shared_exports" path="exports/" />')
    expect(fileProviderPaths).not.toContain('<external-path')
  })

  it('публикует APK автоматически после web-релиза и допускает ручной перезапуск', () => {
    expect(releaseWorkflow).toContain('workflow_call:')
    expect(releaseWorkflow).toContain('workflow_dispatch:')
    expect(releaseWorkflow).toContain('ANDROID_KEYSTORE_BASE64')
    expect(releaseWorkflow).toMatch(/chmod \+x gradlew\s+\.\/gradlew --no-daemon clean assembleRelease/)
    expect(releaseWorkflow).toContain('app-release.apk')
    expect(autoReleaseWorkflow).toContain('uses: ./.github/workflows/android-release.yml')
    expect(autoReleaseWorkflow).toContain('tag: ${{ needs.verify.outputs.tag }}')
    expect(autoReleaseWorkflow).toContain('run_source_checks: false')
    expect(autoReleaseWorkflow).toContain('secrets: inherit')
    expect(releaseWorkflow).toContain('if: inputs.run_source_checks')
    expect(releaseWorkflow.match(/ANDROID_KEYSTORE_PATH: \$\{\{ runner\.temp \}\}/g)).toHaveLength(2)
  })

  it('регистрирует системную печать Android для WebView', () => {
    expect(mainActivity).toContain('registerPlugin(AndroidPrintPlugin.class)')
    expect(androidPrintPlugin).toContain('@CapacitorPlugin(name = "AndroidPrint")')
    expect(androidPrintPlugin).toContain('createPrintDocumentAdapter(jobName)')
    expect(androidPrintPlugin).toContain('PrintAttributes.MediaSize.ISO_A4')
  })
})
