// Blocks gh pr create/merge unless functionality is confirmed.
// The agent must ask the user for confirmation first, then create
// .opencode/confirmed to proceed.
import { existsSync } from 'fs';
import { join } from 'path';

export default (async ({ directory }) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.toolName !== 'bash') return;
      const cmd = output.args.command;
      if (!/gh pr (create|merge)/.test(cmd ?? '')) return;

      const confirmedFile = join(directory ?? process.cwd(), '.opencode', 'confirmed');
      if (!existsSync(confirmedFile)) {
        output.args.command =
          `echo "BLOCKED: PR not created — ask the user to confirm the functionality works, then create .opencode/confirmed and re-run." && exit 1`;
      }
    },
  };
}) satisfies import('@opencode-ai/plugin').Plugin;
