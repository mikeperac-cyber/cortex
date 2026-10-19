# Cortex — Second Brain & Productivity Desktop App

A premium Obsidian alternative built with Electron. Local-first markdown notes with an integrated task manager, daily journal, spaced repetition system, query engine, and focus timer.

## Features

### Core
- **Markdown Editor** — Live preview, syntax highlighting, keyboard shortcuts
- **File Explorer** — Hierarchical vault with folders, drag-and-drop
- **Graph View** — Force-directed graph showing note connections
- **Search** — Full-text search across all notes
- **Backlinks** — See which notes link to the current note
- **Command Palette** — Quick access to all commands (Ctrl+P)
- **Local-First** — All data stored as markdown files in your vault

## 5 Integrated Plugins

| Plugin | Description |
|--------|-------------|
| **TaskFlow** | Kanban board with drag-and-drop, priorities, tags, and due dates |
| **DailySync** | Daily notes, calendar, journaling, and habit tracking |
| **Recall** | Spaced repetition flashcards with SM-2 algorithm |
| **DataForge** | Query engine and templates (Meeting Notes, Project Brief, etc.) |
| **FocusPulse** | Pomodoro timer with session tracking and daily goals |

## Getting Started

```bash
# Install dependencies
npm install

# Run the app
npm start

# Build for production
npm run build
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+P` | Command Palette |
| `Ctrl+N` | New File |
| `Ctrl+S` | Save File |
| `Ctrl+E` | Toggle Preview |
| `Ctrl+G` | Graph View |
| `Ctrl+Shift+F` | Search |
| `Ctrl+W` | Close Tab |

## Plugin Access

Open the Command Palette (`Ctrl+P`) and type:
- "Open TaskFlow"
- "Open DailySync"
- "Open Recall"
- "Open DataForge"
- "Open FocusPulse"

## Data Storage

All data is stored locally in your vault:
- **Notes** — Markdown files in `~/Documents/CortexVault/`
- **Tasks** — `localStorage`
- **Flashcards** — `localStorage`
- **Focus Stats** — `localStorage`

## License

MIT
