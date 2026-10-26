// Windows-safe child-process command: .cmd/.bat shims run through cmd.exe with
// verbatim, escaped arguments; every other platform spawns the executable directly.
const CMD_META_PATTERN = /([()\][%!^"`<>&|;, *?])/g;
const NODE_CMD_SHIM_PATTERN = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

export interface ProcessCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

function escapeCmdCommand(value: string): string {
  return value.replace(CMD_META_PATTERN, '^$1');
}

function escapeCmdArgument(value: string, doubleEscapeMeta: boolean): string {
  let escaped = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(CMD_META_PATTERN, '^$1');
  return doubleEscapeMeta ? escaped.replace(CMD_META_PATTERN, '^$1') : escaped;
}

export function processCommand(
  executable: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): ProcessCommand {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { executable, args };
  }
  const commandPrompt = process.env.ComSpec
    || `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\cmd.exe`;
  const doubleEscapeMeta = NODE_CMD_SHIM_PATTERN.test(executable);
  const shellCommand = [
    escapeCmdCommand(executable),
    ...args.map((arg) => escapeCmdArgument(arg, doubleEscapeMeta)),
  ].join(' ');
  return {
    executable: commandPrompt,
    args: ['/d', '/s', '/c', `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
}
