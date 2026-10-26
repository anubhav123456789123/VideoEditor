import type { AgentContext } from '../context';
import { executeGenerateCommand, type GenerateArgs } from './generate-tool-handlers';
import { GENERATE_TOOL_SCHEMAS } from './generate-schemas';

export { GENERATE_TOOL_NAMES } from './generate-schemas';
export { GENERATE_TOOL_SCHEMAS };

export async function execGenerateTool(name: string, args: GenerateArgs, ctx: AgentContext): Promise<unknown> {
  return executeGenerateCommand(name, args, ctx);
}
