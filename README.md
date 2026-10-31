# @lp-labs/react-terminal

A controlled React command UI with history, completion, async handler lifecycle
and cooperative cancellation. It is not a shell, PTY, process launcher or ANSI
emulator. Commands run only in the handler you provide. React 18 or 19 is the only
peer dependency; there are no runtime dependencies.

## Installation

```sh
npm install @lp-labs/react-terminal react
```

```tsx
import { useState } from "react";
import {
  Terminal, type TerminalEntry, type CommandContext,
} from "@lp-labs/react-terminal";
import "@lp-labs/react-terminal/styles.css";

export function Console() {
  const [value, onValueChange] = useState("");
  const [history, onHistoryChange] = useState<string[]>([]);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);

  async function onCommand(_command: string, { args, signal }: CommandContext) {
    if (signal.aborted) return;
    switch (args[0]) {
      case "help": return "Commands: help, echo";
      case "echo": return args.slice(1).join(" ");
      default: throw new Error("Unknown command. Try help.");
    }
  }

  return (
    <Terminal
      value={value}
      onValueChange={onValueChange}
      history={history}
      onHistoryChange={onHistoryChange}
      entries={entries}
      onEntry={(entry) => setEntries((previous) => {
        const index = previous.findIndex((item) => item.id === entry.id);
        return index < 0
          ? [...previous, entry].slice(-200)
          : previous.map((item) => item.id === entry.id ? entry : item);
      })}
      onCommand={onCommand}
      complete={(prefix) => ["help", "echo"].filter((item) => item.startsWith(prefix))}
    />
  );
}
```

ESM and CommonJS expose the same named API:
`const { Terminal } = require("@lp-labs/react-terminal")`.
There is no default export. Load CSS through your application bundler.
Importing the module does not access the DOM or start command execution.

## Terminal props

`TerminalProps` is the exported interface. Input text, history and output entries
are controlled. Only execution state, history cursor/draft, completions and
announcement text are internal.

| Prop | Type | Default / behavior |
| --- | --- | --- |
| `value` | `string` | Required; current input |
| `onValueChange` | `(value: string) => void` | Required; parent updates input |
| `onCommand` | `(command: string, context: CommandContext) => string \| void \| Promise<string \| void>` | Required; application executor |
| `onEntry` | `(entry: TerminalEntry) => void` | Required; upsert entries by ID |
| `entries` | `readonly TerminalEntry[]` | `[]`; caller order |
| `history` | `readonly string[]` | `[]`; oldest first |
| `onHistoryChange` | `(history: string[]) => void` | Absent; no history updates |
| `complete` | `(value: string) => readonly string[]` | Absent; normal Tab focus navigation |
| `disabled` | `boolean` | `false`; prevents input/submission/completion selection |
| `prompt` | `string` | `">"`; decorative output/input prefix |
| `maxEntries` | `number` | `200`; display newest N entries |
| `maxOutputLength` | `number` | `10000`; per displayed output |
| `className` | `string` | `""`; appended to `lp-terminal` |
| `style` | `CSSProperties` | Absent; outer section |
| `ariaLabel` | `string` | `"Command terminal"` |

Finite display limits are floored and clamped at zero; nonfinite limits use their
defaults. Output overflow adds `"\n[Truncated]"`. Limits affect rendering only,
not emitted entries or parent storage. Command text itself is not truncated.

## Lifecycle and errors

1. Blank/disabled input is ignored. The trimmed command is tokenized first.
2. Syntax failure announces an error without executing, clearing input or emitting an entry.
3. A unique ID is allocated, input cleared, history updated (default cap 100), and
   a `running` entry emitted. Only one command runs at a time.
4. The handler gets parsed `args` including the command name and an `AbortSignal`.
5. A returned string becomes `success` output; `void` becomes `""`. Sync throws
   and rejected promises become `error` entries, with error message/string output.
   The same ID is used for the final update.
6. Cancel aborts the signal and immediately emits `cancelled` with output
   `"Cancelled"`. A new command may then start. Late resolution/rejection is ignored.
7. Unmount aborts without another `onEntry` callback or state update.

Cancellation is cooperative; it does not stop CPU work or undo handler side
effects. Pass the signal to your own async APIs. No timeout or global keyboard
listener is installed. Commands that never settle stay running until cancellation
or unmount. Changing `disabled` does not abort an already running handler.
State notification callbacks (`onEntry`, `onValueChange`, `onHistoryChange`) must
not throw. Completion callback errors are announced, not emitted as command errors.

## Types and pure helpers

- `TerminalStatus`: `"running" | "success" | "error" | "cancelled"`.
- `TerminalEntry`: `{ id: string; command: string; output: string; status: TerminalStatus }`.
- `CommandContext`: `{ args: readonly string[]; signal: AbortSignal }`.
- `TerminalProps`: complete props interface above.

### CommandParseError

Exported `Error` subclass with `name = "CommandParseError"` and constructor
`new CommandParseError(message: string)`. `parseCommand` throws it for an unclosed
quote or trailing escape. The UI catches it and announces its message.

### parseCommand(command: string): string[]

Splits whitespace outside quotes, supports single/double quoted arguments and
empty quotes, and backslash escaping outside single quotes. Escapes simply retain
the following character; `\n` is not decoded to a newline. Single-quoted backslashes
are literal. Returns `[]` for whitespace input. It does NOT perform expansion,
redirection, pipelines, environment lookup, shell execution or security validation.

### appendHistory(history, command, limit = 100): string[]

Takes `readonly string[]` and `string`, returns a new array with a trimmed,
nonblank command appended unless equal to the last item. Returns the most recent
N items; input is not mutated. Finite limits are floored/clamped at zero; nonfinite
limits use 100. A zero limit returns `[]`, including for empty commands.

### getCompletions(value, candidates): string[]

Takes `string` and `readonly string[]`, returns unique, sorted full-input candidates
that begin with `value`. Matching is case-sensitive. No argument-position parsing
or async completion is included. This helper never mutates candidates.

```ts
import {
  parseCommand, CommandParseError, appendHistory, getCompletions,
  type TerminalStatus,
} from "@lp-labs/react-terminal";

try {
  console.log(parseCommand('echo "two words"')); // ["echo", "two words"]
} catch (error) {
  if (error instanceof CommandParseError) console.error(error.message);
}
const history = appendHistory([], "help", 50);
const suggestions = getCompletions("he", ["help", "hello", "echo"]);
const status: TerminalStatus = "success";
console.log(history, suggestions, status);
```

## Keyboard, accessibility and customization

Enter/Run submits. ArrowUp/ArrowDown navigate supplied history and restore the
draft after the newest entry. Editing resets the history cursor. Tab invokes
`complete` when provided: one match fills input; multiple matches render native
completion buttons. With no matches Tab keeps normal focus navigation.
IME composition does not trigger history/completion keyboard actions.

The command field is labeled; lifecycle and completion feedback use `role="status"`.
Output is an ordered list with textual statuses, not color-only signals. Focus
outlines are visible. Output is plain escaped text, with no HTML/ANSI interpretation.
There is no forced focus, autoscroll, focus trap or global shortcut; applications
can implement scroll policies around the component. Disable state is reflected by
native controls.

Override `--lp-terminal-accent` and `--lp-terminal-background` on `.lp-terminal`,
or supply `className` / `style`. Use `prompt="$"` for a different decorative prefix.

## Performance and real limits

Rendering is bounded by the display limits but the parent must bound stored
entries/history and command sizes. All emitted output is retained by the caller
unless it discards it. No streaming, stdin, terminal escape handling, subprocess
execution, shell sandbox or remote connection is supplied. Allowlist commands in
your executor; never pass untrusted input into a shell merely because it was
tokenized. Handler network calls, persistence and secrets are your responsibility.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
