import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget, type WidgetConfig } from '../src/Widget';

// jsdom has no real camera — CameraView is deliberately not exercised for
// its actual video/canvas behavior here (not meaningfully testable outside
// a real browser with real hardware, see the plan). This just proves the
// Welcome -> capture-step transition and the "camera unsupported" fallback
// message render correctly — the flow-sequencing logic itself is covered
// exhaustively in state-machine.test.ts.
describe('Widget', () => {
  const config: WidgetConfig = {
    sessionToken: 'test-token',
    apiBaseUrl: 'http://localhost:3000',
  };

  beforeEach(() => {
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: undefined,
    });
  });

  it('renders the welcome screen first', () => {
    render(<Widget config={config} />);
    expect(
      screen.getByText(/let's verify your identity/i),
    ).toBeInTheDocument();
  });

  it('moves to the passport capture step on "Get started", and shows the camera-required message when unsupported', async () => {
    render(<Widget config={config} />);
    await userEvent.click(screen.getByRole('button', { name: /get started/i }));

    expect(screen.getByText(/scan your passport/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/camera access is not supported/i),
    ).toBeInTheDocument();
    // No upload fallback anywhere — camera-only, per the plan.
    expect(screen.queryByRole('button', { name: /upload/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});
