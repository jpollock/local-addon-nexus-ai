/**
 * Unit tests for SiteHealthBadge component
 */
import * as React from 'react';
import { SiteHealthBadge } from '../../../src/renderer/components/SiteHealthBadge';
import { IPC_CHANNELS } from '../../../src/common/constants';

function createMockElectron(score: number | null = null, shouldFail = false) {
  return {
    ipcRenderer: {
      invoke: jest.fn(async (channel: string, ...args: any[]) => {
        if (channel === IPC_CHANNELS.HEALTH_GET_SCORE) {
          if (shouldFail) {
            return { success: false, error: 'Test error' };
          }
          return { success: true, score };
        }
        return { success: false, error: 'Unknown channel' };
      }),
    },
  };
}

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

describe('SiteHealthBadge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should render score when provided as prop', () => {
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
      score: 85,
    });

    spySetState(instance);
    instance['_mounted'] = true;

    // Simulate componentDidMount setting score from prop
    instance.componentDidMount();

    expect(instance.state.score).toBe(85);
    expect(instance.state.loading).toBe(false);
    // Should NOT call IPC when score prop is provided
    expect(mockElectron.ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('should show green color for score >= 80', () => {
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
      score: 92,
    });

    spySetState(instance);
    instance['_mounted'] = true;
    instance.componentDidMount();

    expect(instance.state.score).toBe(92);

    // Render and check color in the output
    const rendered = instance.render() as any;
    const style = rendered.props.style;
    // Green color: #22c55e
    expect(style.color).toBe('#22c55e');
    expect(style.border).toContain('#22c55e');
  });

  test('should show yellow color for score 50-79', () => {
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
      score: 65,
    });

    spySetState(instance);
    instance['_mounted'] = true;
    instance.componentDidMount();

    expect(instance.state.score).toBe(65);

    const rendered = instance.render() as any;
    const style = rendered.props.style;
    // Yellow color: #f59e0b
    expect(style.color).toBe('#f59e0b');
    expect(style.border).toContain('#f59e0b');
  });

  test('should show red color for score < 50', () => {
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
      score: 30,
    });

    spySetState(instance);
    instance['_mounted'] = true;
    instance.componentDidMount();

    expect(instance.state.score).toBe(30);

    const rendered = instance.render() as any;
    const style = rendered.props.style;
    // Red color: #ef4444
    expect(style.color).toBe('#ef4444');
    expect(style.border).toContain('#ef4444');
  });

  test('should show dash when loading', () => {
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
    });

    // Don't call componentDidMount, so loading stays true
    expect(instance.state.loading).toBe(true);
    expect(instance.state.score).toBeNull();

    const rendered = instance.render() as any;
    // Should show em-dash character
    expect(rendered.props.children).toBe('\u2014');
  });

  test('should handle click event', () => {
    const onClick = jest.fn();
    const mockElectron = createMockElectron();
    const instance = new SiteHealthBadge({
      electron: mockElectron,
      siteId: 'site-1',
      score: 75,
      onClick,
    });

    spySetState(instance);
    instance['_mounted'] = true;
    instance.componentDidMount();

    const rendered = instance.render() as any;

    // Verify onClick is wired up
    expect(rendered.props.onClick).toBe(onClick);
    expect(rendered.props.style.cursor).toBe('pointer');
  });
});
