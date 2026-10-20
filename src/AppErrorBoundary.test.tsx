import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './AppErrorBoundary'

const Broken = () => { throw new Error('render failed') }

describe('AppErrorBoundary', () => {
  it('replaces a crashed screen without showing the error text', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'This page hit a problem.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByText(/render failed/)).not.toBeInTheDocument()
  })
})
