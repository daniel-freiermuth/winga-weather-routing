#!/usr/bin/env python3
# SessionStart hook: injects project rules and memory files into Claude's context.
import json, os, re
from pathlib import Path

parts = []
warnings = []

# Global CLAUDE.md
global_claude = Path.home() / '.claude' / 'CLAUDE.md'
if global_claude.exists():
    parts.append(f'=== {global_claude} ===\n' + global_claude.read_text())

# Project CLAUDE.md — derived from this script's location (.claude/read-rules.py → repo root)
project_claude = Path(__file__).resolve().parent.parent / 'CLAUDE.md'
if project_claude.exists():
    parts.append(f'=== {project_claude} ===\n' + project_claude.read_text())

# Memory files — path is hardcoded; hook instructs Claude to fix it if wrong
MEMORY_DIR = Path('/home/kw/.claude/projects/-home-kw-src-weather-routing/memory')

if not MEMORY_DIR.exists():
    warnings.append(
        f'WARNING: The memory directory in .claude/read-rules.py does not exist: {MEMORY_DIR}\n'
        f'Read .claude/read-rules.py, find the correct memory path for this machine '
        f'(~/.claude/projects/<sanitized-cwd>/memory/ where <sanitized-cwd> is the absolute '
        f'project path with "/" replaced by "-"), update the MEMORY_DIR constant, and commit.'
    )
else:
    idx = MEMORY_DIR / 'MEMORY.md'
    if idx.exists():
        parts.append(f'=== {idx} ===\n' + idx.read_text())
        for line in idx.read_text().splitlines():
            m = re.search(r'\[.*?\]\((\S+\.md)\)', line)
            if m:
                mf = MEMORY_DIR / m.group(1)
                if mf.exists():
                    parts.append(mf.read_text())

context = '\n\n'.join(parts)
if warnings:
    context = '\n\n'.join(warnings) + ('\n\n' + context if context else '')

print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': context
    }
}))
