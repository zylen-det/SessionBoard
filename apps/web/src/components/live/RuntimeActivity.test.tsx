import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeActivity } from './RuntimeActivity'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runtime activity animation lifecycle', () => {
  it('keeps the existing icon looping when activity becomes unknown', () => {
    const { container, rerender } = render(<RuntimeActivity kind="tool" text="tool: Read" title="Read" />)
    act(() => vi.advanceTimersByTime(720))
    const glyph = container.querySelector('.runtime-glyph')
    rerender(<RuntimeActivity kind="unknown" text="proccessing" title="proccessing" />)
    expect(container).toHaveTextContent('proccessing')
    expect(container.querySelector('.runtime-glyph')).toBe(glyph)
    expect(glyph).toHaveAttribute('data-kind', 'tool')
    expect(glyph).toHaveAttribute('data-phase', 'loop')
    act(() => vi.advanceTimersByTime(10000))
    expect(container.querySelector('.runtime-glyph')).toBe(glyph)
    expect(glyph).toHaveAttribute('data-phase', 'loop')
  })

  it('shows the existing reasoning icon when no initial activity is known', () => {
    const { container } = render(<RuntimeActivity kind="unknown" text="proccessing" title="proccessing" />)
    act(() => vi.advanceTimersByTime(772))
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-kind', 'reasoning')
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-phase', 'loop')
  })

  it('keeps the outgoing glyph and text until its exit finishes', () => {
    const { container, rerender } = render(<RuntimeActivity kind="tool" text="tool: Read" title="Read" />)
    const glyph = () => container.querySelector('.runtime-glyph')
    expect(glyph()).toHaveAttribute('data-phase', 'enter')
    act(() => vi.advanceTimersByTime(720))
    expect(glyph()).toHaveAttribute('data-phase', 'loop')

    const oldGlyph = glyph()
    rerender(<RuntimeActivity kind="reasoning" text="reasoning" title="reasoning" />)
    expect(glyph()).toBe(oldGlyph)
    expect(glyph()).toHaveAttribute('data-phase', 'exit')
    expect(container).toHaveTextContent('tool: Read')
    expect(container).not.toHaveTextContent('reasoning')
    act(() => vi.advanceTimersByTime(671))
    expect(glyph()).toBe(oldGlyph)
    act(() => vi.advanceTimersByTime(1))
    expect(glyph()).not.toBe(oldGlyph)
    expect(glyph()).toHaveAttribute('data-kind', 'reasoning')
    expect(glyph()).toHaveAttribute('data-phase', 'enter')
    expect(container).toHaveTextContent('reasoning')
    act(() => vi.advanceTimersByTime(772))
    expect(glyph()).toHaveAttribute('data-phase', 'loop')
    act(() => vi.advanceTimersByTime(10000))
    expect(glyph()).toHaveAttribute('data-phase', 'loop')
  })

  it('coalesces changes during exit without restarting its deadline', () => {
    const { container, rerender } = render(<RuntimeActivity kind="tool" text="tool" title="tool" />)
    // An activity may end before its entrance completes.
    act(() => vi.advanceTimersByTime(200))
    rerender(<RuntimeActivity kind="reasoning" text="reasoning" title="reasoning" />)
    act(() => vi.advanceTimersByTime(300))
    rerender(<RuntimeActivity kind="outputting" text="outputting" title="outputting" />)
    act(() => vi.advanceTimersByTime(372))
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-kind', 'outputting')
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-phase', 'enter')
    expect(container.querySelector('.runtime-dot')).toBeNull()
  })

  it('updates details within a phase without restarting the entrance', () => {
    const { container, rerender } = render(<RuntimeActivity kind="tool" text="tool: Read" title="Read" />)
    const glyph = container.querySelector('.runtime-glyph')
    act(() => vi.advanceTimersByTime(500))
    rerender(<RuntimeActivity kind="tool" text="tool: Edit" title="Edit" />)
    act(() => vi.advanceTimersByTime(220))
    expect(container.querySelector('.runtime-glyph')).toBe(glyph)
    expect(glyph).toHaveAttribute('data-phase', 'loop')
    expect(container).toHaveTextContent('tool: Edit')
    expect(container.querySelector('.runtime-text-out')).toBeNull()
  })

  it('switches immediately when reduced motion is requested', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    const { container, rerender } = render(<RuntimeActivity kind="tool" text="tool" title="tool" />)
    rerender(<RuntimeActivity kind="outputting" text="outputting" title="outputting" />)
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-kind', 'outputting')
    expect(container.querySelector('.runtime-glyph')).toHaveAttribute('data-phase', 'loop')
  })
})
