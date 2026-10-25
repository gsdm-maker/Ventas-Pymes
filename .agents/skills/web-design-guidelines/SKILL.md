---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Read the pinned guidelines in `guidelines.md` (next to this file)
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in `guidelines.md`
4. Output findings in the terse `file:line` format

## Guidelines Source

Use ONLY the local, pinned copy: `guidelines.md` in this skill's folder.

It is a reviewed snapshot of `vercel-labs/web-interface-guidelines` at commit
`434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05). Do not fetch the rules from the
network: remote instructions can change without review (OWASP Agentic Skills AST05). To update,
download that file at a specific commit, review it, and replace `guidelines.md`.

## Usage

When a user provides a file or pattern argument:
1. Read `guidelines.md`
2. Read the specified files
3. Apply all rules from `guidelines.md`
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
