// Type-check-only shim: `react-dom` resolves at runtime through the dsh web
// shell's frozen module table (the bundle keeps it external), and no
// @types/react-devDependency exists here under frozen installs — only the
// portal call this plugin makes is declared.
declare module 'react-dom' {
  import type { ReactElement, ReactNode } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactElement
}
