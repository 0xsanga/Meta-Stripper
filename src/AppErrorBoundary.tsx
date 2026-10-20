import { Component, type ErrorInfo, type ReactNode } from 'react'

interface BoundaryState { failed: boolean }

export class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main className="error-boundary">
      <h1>This page hit a problem.</h1>
      <p>Reload to start again. Nothing from this tab was uploaded.</p>
      <button className="button button-dark" type="button" onClick={() => window.location.reload()}>Reload</button>
    </main>
  }
}
