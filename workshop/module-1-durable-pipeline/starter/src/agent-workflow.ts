// The AI underwriting agent — you implement this in Module 4.
// Until then it's a stub so the project compiles. The real loop calls the LLM,
// dispatches any tools it asks for, and parses a final recommendation.

import type { AgentInput, AgentRecommendation } from './models';

export async function underwritingAgentWorkflow(
  _input: AgentInput
): Promise<AgentRecommendation> {
  // TODO(module-4): replace this stub with the tool-call loop.
  return {
    decision: 'ESCALATE',
    confidence: 0,
    rationale: 'Agent not implemented yet (Module 4).',
    toolCallTrace: [],
    turns: 0,
    model: 'none',
    completedAt: new Date().toISOString(),
  };
}
