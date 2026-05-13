import { dbg, Debug } from '../debug.js';

describe('Debug system', () => {
  test('dbg.ai.info don\'t throw an error when disabled', () => {
    Debug.disableAll();
    expect(() => dbg.ai.info('test')).not.toThrow();
  });

  test('Debug.status reflects the active modules', () => {
    Debug.enable('ai', 'rules');
    const status = Debug.status();
    expect(status.active).toContain('ai');
    expect(status.active).toContain('rules');
    Debug.disableAll();
  });
});