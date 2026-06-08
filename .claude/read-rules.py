#!/usr/bin/env python3
# SessionStart hook: injects project rules and memory files into Claude's context.
import json, os, re

parts = []

for path in [os.path.expanduser('~/.claude/CLAUDE.md'),
             '/home/kw/src/weather-routing/CLAUDE.md']:
    if os.path.exists(path):
        parts.append('=== ' + path + ' ===\n' + open(path).read())

mem_dir = os.path.expanduser(
    '~/.claude/projects/-home-kw-src-weather-routing/memory')
idx = os.path.join(mem_dir, 'MEMORY.md')
if os.path.exists(idx):
    parts.append('=== ' + idx + ' ===\n' + open(idx).read())
    for line in open(idx):
        m = re.search(r'\[.*?\]\((\S+\.md)\)', line)
        if m:
            mf = os.path.join(mem_dir, m.group(1))
            if os.path.exists(mf):
                parts.append(open(mf).read())

print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': '\n\n'.join(parts)
    }
}))
