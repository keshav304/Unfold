import { render, screen } from '@testing-library/react'

/**
 * P0.1 scaffold smoke: proves the Vitest + Testing Library wiring works before
 * any pipeline code exists. No product behavior is asserted here.
 */
describe('test harness', () => {
  it('renders a component in jsdom', () => {
    render(<p>ok</p>)
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
