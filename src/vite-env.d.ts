/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BUILD_DATE__: string
declare const __COMMIT_SHA__: string

declare module '*.md?raw' {
  const content: string
  export default content
}
