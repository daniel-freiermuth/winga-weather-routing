// Enforces the New Requirements Rule: after adding a row to SPEC.md's Open
// Requirements table, block non-read tool calls until the user approves.
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const MARKER = 'new-req-pending';
const READ_ONLY = new Set(['read', 'glob', 'grep', 'webfetch', 'websearch', 'question']);

export default (async ({ directory }) => {
  return {
    "tool.execute.after": async (input) => {
      if (input.toolName !== 'edit') return;
      const filePath = input.args?.filePath ?? '';
      if (!filePath.toString().endsWith('SPEC.md')) return;
      const newString = (input.args?.newString ?? '').toString();
      // Detect addition of a new Open Requirements table row
      if (!newString.includes('| [REQ-')) return;
      const markerPath = join(directory ?? process.cwd(), '.opencode', MARKER);
      writeFileSync(markerPath, new Date().toISOString() + '\n');
    },

    "tool.execute.before": async (input, output) => {
      const markerPath = join(directory ?? process.cwd(), '.opencode', MARKER);
      if (!existsSync(markerPath)) return;
      if (READ_ONLY.has(input.toolName)) return;

      // Allow the user's own commands unless explicitly a write tool
      if (input.toolName === 'bash') {
        output.args.command =
          `echo "BLOCKED by new-req-guard: a new requirement was just logged — do not analyze, plan, or implement. Ask the user if they want to proceed, then delete .opencode/${MARKER} to continue." && exit 1`;
        return;
      }

      if (input.toolName === 'edit') {
        // Make the edit fail harmlessly
        output.args.oldString = '__NEW_REQ_GUARD_BLOCKED__';
        return;
      }

      if (input.toolName === 'write') {
        output.args.content = `BLOCKED by new-req-guard: a new requirement was just logged — do not analyze, plan, or implement.\n`;
        return;
      }

      if (input.toolName === 'task') {
        output.args.prompt = `BLOCKED by new-req-guard: a new requirement was just logged — do not analyze, plan, or implement.\n`;
        return;
      }
    },
  };
}) satisfies import('@opencode-ai/plugin').Plugin;
