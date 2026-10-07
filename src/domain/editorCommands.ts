export interface EditorCommand {
  id: string;
  label: string;
  category: string;
  keywords?: string;
  shortcut?: string;
  enabled: boolean;
  run: () => void;
}

/** UI entry points share command availability, including keyboard invocation. */
export function invokeEditorCommand(commands: readonly EditorCommand[], id: string): boolean {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command?.enabled) return false;
  command.run();
  return true;
}

export function searchEditorCommands(commands: readonly EditorCommand[], query: string): EditorCommand[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return commands.map((command, index) => {
    const label = command.label.toLocaleLowerCase();
    const text = `${label} ${command.category} ${command.keywords ?? ""} ${command.id}`.toLocaleLowerCase();
    let score = 0;
    for (const word of words) {
      if (label === word) score += 150;
      else if (label.startsWith(word)) score += 100;
      else if (label.includes(word)) score += 50;
      else if (text.includes(word)) score += 10;
      else {
        let offset = 0;
        for (const char of word) {
          const match = text.indexOf(char, offset);
          if (match < 0) return null;
          offset = match + 1;
        }
        score += 1;
      }
    }
    return { command, score, index };
  }).filter((hit): hit is { command: EditorCommand; score: number; index: number } => hit !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index).map((hit) => hit.command);
}
