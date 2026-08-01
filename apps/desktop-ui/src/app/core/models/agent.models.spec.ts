import { CLAUDE_PROVIDER_PRESETS } from './agent.models';

describe('Claude provider presets', () => {
  it('uses the provider model id for MiniMax M3 without a context annotation', () => {
    const minimax = CLAUDE_PROVIDER_PRESETS.find((preset) => preset.provider === 'MiniMax');

    expect(minimax).toEqual(
      expect.objectContaining({
        name: 'MiniMax M3',
        model: 'MiniMax-M3',
        baseUrl: 'https://api.minimaxi.com/anthropic',
      }),
    );
  });
});
