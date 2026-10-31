import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

export class CommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandParseError';
  }
}

export function parseCommand(command: string): string[] {
  const args: string[] = [];
  let token = '';
  let quote = '';
  let escaped = false;
  let started = false;
  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      started = true;
    } else if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = '';
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(token);
      token = '';
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (escaped) throw new CommandParseError('Trailing escape in command.');
  if (quote) throw new CommandParseError('Unclosed quote in command.');
  if (started) args.push(token);
  return args;
}

export function appendHistory(history: readonly string[], command: string, limit = 100): string[] {
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
  const value = command.trim();
  const next = value && history[history.length - 1] !== value ? [...history, value] : [...history];
  return count ? next.slice(-count) : [];
}

export function getCompletions(value: string, candidates: readonly string[]): string[] {
  return [...new Set(candidates)].filter((candidate) => candidate.startsWith(value)).sort();
}

export type TerminalStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface TerminalEntry {
  id: string;
  command: string;
  output: string;
  status: TerminalStatus;
}

export interface CommandContext {
  args: readonly string[];
  signal: AbortSignal;
}

export interface TerminalProps {
  value: string;
  onValueChange: (value: string) => void;
  onCommand: (command: string, context: CommandContext) => string | void | Promise<string | void>;
  onEntry: (entry: TerminalEntry) => void;
  entries?: readonly TerminalEntry[];
  history?: readonly string[];
  onHistoryChange?: (history: string[]) => void;
  complete?: (value: string) => readonly string[];
  disabled?: boolean;
  prompt?: string;
  maxEntries?: number;
  maxOutputLength?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export function Terminal({
  value,
  onValueChange,
  onCommand,
  onEntry,
  entries = [],
  history = [],
  onHistoryChange,
  complete,
  disabled = false,
  prompt = '>',
  maxEntries = 200,
  maxOutputLength = 10000,
  className = '',
  style,
  ariaLabel = 'Command terminal',
}: TerminalProps) {
  const inputId = useId();
  const sequence = useRef(0);
  const active = useRef<{ controller: AbortController; entry: TerminalEntry } | null>(null);
  const mounted = useRef(false);
  const cursor = useRef<number | null>(null);
  const draft = useRef('');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = active.current;
      active.current = null;
      current?.controller.abort();
    };
  }, []);

  const cancel = () => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    current.controller.abort();
    setPending(false);
    setFeedback('Command cancelled.');
    onEntry({ ...current.entry, status: 'cancelled', output: 'Cancelled' });
  };

  const execute = async () => {
    if (disabled || active.current || !value.trim()) return;
    const command = value.trim();
    let args: string[];
    try {
      args = parseCommand(command);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Invalid command.');
      return;
    }
    const controller = new AbortController();
    const entry: TerminalEntry = {
      id: `${inputId}-${++sequence.current}`,
      command,
      output: '',
      status: 'running',
    };
    active.current = { controller, entry };
    setPending(true);
    setFeedback('Running command.');
    setSuggestions([]);
    cursor.current = null;
    onValueChange('');
    onHistoryChange?.(appendHistory(history, command));
    onEntry(entry);
    let result: TerminalEntry;
    try {
      const output = await onCommand(command, { args, signal: controller.signal });
      result = { ...entry, status: 'success', output: output ?? '' };
    } catch (error) {
      result = {
        ...entry,
        status: 'error',
        output: error instanceof Error ? error.message : String(error),
      };
    }
    if (!mounted.current || active.current?.controller !== controller) return;
    active.current = null;
    setPending(false);
    setFeedback(result.status === 'success' ? 'Command completed.' : 'Command failed.');
    onEntry(result);
  };

  const entryLimit = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 200;
  const outputLimit = Number.isFinite(maxOutputLength)
    ? Math.max(0, Math.floor(maxOutputLength))
    : 10000;
  const visible = entryLimit ? entries.slice(-entryLimit) : [];
  return (
    <section className={`lp-terminal ${className}`} style={style} aria-label={ariaLabel}>
      <ol className="lp-terminal-output" aria-label="Command output">
        {visible.map((entry) => (
          <li key={entry.id} data-status={entry.status}>
            <div>
              <span aria-hidden="true">{prompt} </span>
              <strong>{entry.command}</strong>
            </div>
            <span className="lp-terminal-state">{entry.status}</span>
            <pre>
              {entry.output.slice(0, outputLimit)}
              {entry.output.length > outputLimit ? '\n[Truncated]' : ''}
            </pre>
          </li>
        ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void execute();
        }}
      >
        <label htmlFor={inputId}>Command</label>
        <div className="lp-terminal-input">
          <span aria-hidden="true">{prompt}</span>
          <input
            id={inputId}
            value={value}
            disabled={disabled || pending}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              cursor.current = null;
              setSuggestions([]);
              onValueChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                if (!history.length) return;
                event.preventDefault();
                if (cursor.current === null) {
                  if (event.key === 'ArrowDown') return;
                  draft.current = value;
                  cursor.current = history.length;
                }
                cursor.current = Math.max(
                  0,
                  Math.min(history.length, cursor.current + (event.key === 'ArrowUp' ? -1 : 1)),
                );
                onValueChange(
                  cursor.current === history.length
                    ? draft.current
                    : (history[cursor.current] ?? ''),
                );
              } else if (event.key === 'Tab' && complete) {
                try {
                  const matches = getCompletions(value, complete(value));
                  if (!matches.length) {
                    setFeedback('No completions.');
                    return;
                  }
                  event.preventDefault();
                  setSuggestions(matches);
                  if (matches.length === 1) onValueChange(matches[0] ?? value);
                  setFeedback(`${matches.length} completions available.`);
                } catch (error) {
                  setFeedback(error instanceof Error ? error.message : 'Completion failed.');
                }
              }
            }}
          />
          <button type="submit" disabled={disabled || pending || !value.trim()}>
            Run
          </button>
          {pending && (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {suggestions.length > 0 && (
        <ul aria-label="Completions">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                disabled={disabled || pending}
                onClick={() => {
                  onValueChange(suggestion);
                  setSuggestions([]);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status">{feedback}</p>
    </section>
  );
}
