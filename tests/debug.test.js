import { dbg, Debug } from '../src/debug.js';

describe('Debug system', () => {
  test('dbg.ai.info no lanza error cuando está desactivado', () => {
    Debug.disableAll();
    expect(() => dbg.ai.info('test')).not.toThrow();
  });

  test('Debug.status refleja los módulos activos', () => {
    Debug.enable('ai', 'rules');
    const status = Debug.status();
    expect(status.active).toContain('ai');
    expect(status.active).toContain('rules');
    Debug.disableAll();
  });
});