/**
 * vLLM API Service - OpenAI Compatible API Client
 * Supports local vLLM deployments with OpenAI-compatible endpoints
 */

export interface VLLMConfig {
  apiUrl: string;
  modelName: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * vLLM API Client Class
 */
export class VLLMClient {
  private config: VLLMConfig;

  constructor(config: VLLMConfig) {
    this.config = {
      maxTokens: 20480,
      temperature: 0.7,
      topP: 0.9,
      ...config,
    };
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
      const response = await fetch(`${this.config.apiUrl}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { success: false, message: `Connection failed: ${response.status} ${response.statusText}` };
      }

      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return {
        success: true,
        message: `Connected successfully. Available models: ${models.join(', ')}`,
        models,
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Send chat completion request (non-streaming)
   */
  async chatCompletion(messages: ChatMessage[], options?: Partial<VLLMConfig>): Promise<ChatCompletionResponse> {
    const requestBody = {
      model: options?.modelName || this.config.modelName,
      messages,
      max_tokens: options?.maxTokens || this.config.maxTokens,
      temperature: options?.temperature || this.config.temperature,
      top_p: options?.topP || this.config.topP,
      stream: false,
    };

    const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Send streaming chat completion request
   */
  async *chatCompletionStream(
    messages: ChatMessage[],
    options?: Partial<VLLMConfig>
  ): AsyncGenerator<string, void, unknown> {
    const requestBody = {
      model: options?.modelName || this.config.modelName,
      messages,
      max_tokens: options?.maxTokens || this.config.maxTokens,
      temperature: options?.temperature || this.config.temperature,
      top_p: options?.topP || this.config.topP,
      stream: true,
    };

    const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;

          try {
            const chunk: StreamChunk = JSON.parse(data);
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<VLLMConfig>) {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Default vLLM client instance
 */
let defaultClient: VLLMClient | null = null;

/**
 * Initialize vLLM client
 */
export function initVLLMClient(config: VLLMConfig): VLLMClient {
  defaultClient = new VLLMClient(config);
  return defaultClient;
}

/**
 * Get vLLM client instance
 */
export function getVLLMClient(): VLLMClient | null {
  return defaultClient;
}

/**
 * Research-specific AI helper functions
 */
export async function analyzeGoalWithAI(goal: string, client: VLLMClient): Promise<{
  subGoals: string[];
  keywords: string[];
  domain: string;
  action: string;
}> {
  const systemPrompt = `You are a research planning assistant. Analyze the given goal and extract:
1. Sub-goals (3-5 specific objectives)
2. Keywords (5-10 relevant search terms)
3. Domain (the research domain/field)
4. Action (the main action type, e.g., "research", "analyze", "compare", "implement")

Respond in JSON format: {"subGoals": [], "keywords": [], "domain": "", "action": ""}`;

  const response = await client.chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Analyze this research goal: "${goal}"` },
  ]);

  const content = response.choices[0]?.message?.content || '';

  // Try to parse JSON from response
  try {
    // Find JSON in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('Failed to parse AI response as JSON:', content);
  }

  // Fallback: return basic structure
  return {
    subGoals: ['Gather information', 'Analyze findings', 'Synthesize results'],
    keywords: goal.split(' ').filter(w => w.length > 3).slice(0, 5),
    domain: 'general',
    action: 'research',
  };
}

/**
 * Generate research insights with streaming
 */
export async function generateResearchInsights(
  context: string,
  client: VLLMClient,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const systemPrompt = `You are a research synthesis assistant. Based on the provided context, generate actionable insights and recommendations. Be concise and structured.`;

  let fullContent = '';

  for await (const chunk of client.chatCompletionStream([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context },
  ])) {
    fullContent += chunk;
    if (onChunk) {
      onChunk(chunk);
    }
  }

  return fullContent;
}

/**
 * Validate research step with AI
 */
export async function validateStepWithAI(
  stepTitle: string,
  stepDescription: string,
  client: VLLMClient
): Promise<{ valid: boolean; suggestions: string[] }> {
  const systemPrompt = `You are a research methodology validator. Check if the given research step is well-defined and actionable.
Respond in JSON format: {"valid": boolean, "suggestions": ["suggestion1", "suggestion2"]}`;

  const response = await client.chatCompletion([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Validate this research step:\nTitle: ${stepTitle}\nDescription: ${stepDescription}` },
  ]);

  const content = response.choices[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn('Failed to parse validation response:', content);
  }

  return { valid: true, suggestions: [] };
}