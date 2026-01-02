import { query } from '@anthropic-ai/claude-agent-sdk';
import { startObservation } from '@langfuse/tracing';
 
// Logging utility functions
const log = {
  info: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  error: (message: string, error?: any) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [ERROR] ${message}`, error);
    if (error instanceof Error) {
      console.error(`[${timestamp}] [ERROR] Stack:`, error.stack);
    }
  },
  debug: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
  warn: (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  },
};

const server = Bun.serve({
  port: 5004,
  async fetch(request) {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const url = new URL(request.url);
    
    log.info(`[${requestId}] Incoming request`, {
      method: request.method,
      url: request.url,
      pathname: url.pathname,
      headers: Object.fromEntries(request.headers.entries()),
    });

    // Handle GET requests
    if (request.method === 'GET') {
      if (url.pathname === '/') {
        return handleGetRoot(request, requestId, startTime);
      } else {
        log.warn(`[${requestId}] Path not found: ${url.pathname}`);
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Handle POST requests
    if (request.method !== 'POST') {
      log.warn(`[${requestId}] Method not allowed: ${request.method}`);
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Route to appropriate POST handler with tracing
    if (url.pathname === '/v1/messages' || url.pathname === '/messages') {
      const trace = startObservation('handle-messages-endpoint', {
        metadata: {
          requestId,
          pathname: url.pathname,
          method: request.method,
        },
      });
      try {
        const response = await handleMessagesEndpoint(request, requestId, startTime, trace);
        trace.update({
          output: { status: response.status },
          metadata: { statusCode: response.status },
        });
        trace.end();
        return response;
      } catch (error) {
        trace.update({
          level: 'ERROR',
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
        trace.end();
        throw error;
      }
    } else if (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions' || url.pathname === '/') {
      const trace = startObservation('handle-chat-completions-endpoint', {
        metadata: {
          requestId,
          pathname: url.pathname,
          method: request.method,
        },
      });
      try {
        const response = await handleChatCompletionsEndpoint(request, requestId, startTime, trace);
        trace.update({
          output: { status: response.status },
          metadata: { statusCode: response.status },
        });
        trace.end();
        return response;
      } catch (error) {
        trace.update({
          level: 'ERROR',
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
        trace.end();
        throw error;
      }
    } else {
      log.warn(`[${requestId}] Path not found: ${url.pathname}`);
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
});

// Handler for GET / route
function handleGetRoot(request: Request, requestId: string, startTime: number): Response {
  const totalTime = Date.now() - startTime;
  
  log.info(`[${requestId}] GET / request completed`, {
    totalTimeMs: totalTime,
    statusCode: 200,
  });

  const response: {
    service: string;
    version: string;
    status: string;
    endpoints: Record<string, { method: string; description: string; format: string }>;
    port: number;
    timestamp: string;
  } = {
    service: 'Claude OpenAI-Compatible Proxy',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      '/v1/chat/completions': {
        method: 'POST',
        description: 'OpenAI-compatible chat completions endpoint',
        format: 'OpenAI API format',
      },
      '/chat/completions': {
        method: 'POST',
        description: 'OpenAI-compatible chat completions endpoint (no version prefix)',
        format: 'OpenAI API format',
      },
      '/v1/messages': {
        method: 'POST',
        description: 'Anthropic Messages API compatible endpoint',
        format: 'Anthropic Messages API format',
      },
      '/messages': {
        method: 'POST',
        description: 'Anthropic Messages API compatible endpoint (no version prefix)',
        format: 'Anthropic Messages API format',
      },
    },
    port: 5004,
    timestamp: new Date().toISOString(),
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Handler for /v1/messages endpoint (Anthropic Messages API compatible)
async function handleMessagesEndpoint(request: Request, requestId: string, startTime: number, parentTrace?: any) {
  try {
    const body = (await request.json()) as {
      model?: string;
      messages?: Array<{
        role: string;
        content: string | Array<{ type: string; text: string }>;
      }>;
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
    };
    
    const { model, messages, max_tokens, temperature, stream } = body;
    
    log.info(`[${requestId}] /v1/messages request parsed`, {
      model: model || '(default)',
      messageCount: messages?.length || 0,
      maxTokens: max_tokens,
      temperature: temperature,
      stream: stream,
    });

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      log.warn(`[${requestId}] Validation failed: messages array is required`);
      return new Response(
        JSON.stringify({ error: { type: 'invalid_request_error', message: 'messages array is required' } }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Convert messages format to a prompt string
    const prompt = messages
      .map((msg: { role: string; content: string | Array<{ type: string; text: string }> }) => {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          content = msg.content
            .filter((block: { type: string }) => block.type === 'text')
            .map((block: { type: string; text: string }) => block.text)
            .join('\n');
        }
        return `${msg.role}: ${content}`;
      })
      .join('\n\n');

    // Prepare options for the SDK
    const options = {
      maxTurns: 1,
      model: model || 'claude-sonnet-4-5',
    };

    // Create generation observation for LLM call
    const generationObs = parentTrace ? parentTrace.startObservation({
      name: 'claude-generation',
      asType: 'generation',
      model: options.model,
      input: {
        prompt,
        model: options.model,
        maxTurns: options.maxTurns,
        temperature,
        maxTokens: max_tokens,
      },
      metadata: {
        requestId,
        stream,
      },
    }) : null;

    // Call the SDK query function
    const sdkStartTime = Date.now();
    const queryResult = query({ prompt, options });

    // Handle streaming response
    if (stream) {
      log.info(`[${requestId}] Starting streaming response`);
      const responseId = `msg-${Date.now()}`;
      const modelName = model || 'claude-sonnet-4-5';
      
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            let assistantContent = '';
            let hasStarted = false;
            
            for await (const message of queryResult) {
              if (message.type === 'assistant') {
                const apiMessage = message.message;
                if (apiMessage.content && Array.isArray(apiMessage.content)) {
                  const textBlocks = apiMessage.content.filter(
                    (block: any) => block.type === 'text'
                  );
                  if (textBlocks.length > 0) {
                    const newText = textBlocks.map((block: any) => block.text).join('\n');
                    
                    // Stream incremental content
                    if (!hasStarted) {
                      // Send start event
                      const startEvent = {
                        type: 'message_start',
                        message: {
                          id: responseId,
                          type: 'message',
                          role: 'assistant',
                          content: [],
                          model: modelName,
                        },
                      };
                      controller.enqueue(new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify(startEvent)}\n\n`));
                      hasStarted = true;
                    }
                    
                    // Stream content delta
                    const delta = newText.slice(assistantContent.length);
                    if (delta) {
                      const contentDelta = {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                          type: 'text_delta',
                          text: delta,
                        },
                      };
                      controller.enqueue(new TextEncoder().encode(`event: content_block_delta\ndata: ${JSON.stringify(contentDelta)}\n\n`));
                    }
                    
                    assistantContent = newText;
                  }
                }
              }
            }
            
            // Send stop event
            const stopEvent = { 
              type: 'message_delta',
              delta: {
                stop_reason: 'end_turn',
                stop_sequence: null,
              },
            };
            controller.enqueue(new TextEncoder().encode(`event: message_delta\ndata: ${JSON.stringify(stopEvent)}\n\n`));
            
            // Send done event
            const doneEvent = {
              type: 'message_stop',
            };
            controller.enqueue(new TextEncoder().encode(`event: message_stop\ndata: ${JSON.stringify(doneEvent)}\n\n`));
            
            const sdkTime = Date.now() - sdkStartTime;
            const totalTime = Date.now() - startTime;
            log.info(`[${requestId}] Streaming completed`, {
              totalTimeMs: totalTime,
              sdkTimeMs: sdkTime,
              responseId,
            });
            
            // Update generation observation
            if (generationObs) {
              generationObs.update({
                output: assistantContent,
                metadata: {
                  responseId,
                  contentLength: assistantContent.length,
                  stream: true,
                },
              });
              generationObs.end();
            }
            
            controller.close();
          } catch (error) {
            log.error(`[${requestId}] Streaming error`, error);
            controller.error(error);
          }
        },
      });
      
      return new Response(streamResponse, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming response
    // Collect assistant messages
    let assistantContent = '';
    let lastAssistantMessage: any = null;
    let messageCount = 0;
    let assistantMessageCount = 0;

    for await (const message of queryResult) {
      messageCount++;
      if (message.type === 'assistant') {
        assistantMessageCount++;
        lastAssistantMessage = message;
        const apiMessage = message.message;
        if (apiMessage.content && Array.isArray(apiMessage.content)) {
          const textBlocks = apiMessage.content.filter(
            (block: any) => block.type === 'text'
          );
          if (textBlocks.length > 0) {
            assistantContent = textBlocks.map((block: any) => block.text).join('\n');
          }
        }
      }
    }

    const sdkTime = Date.now() - sdkStartTime;

    // Update generation observation for non-streaming
    if (generationObs) {
      generationObs.update({
        output: assistantContent,
        metadata: {
          messageCount,
          assistantMessageCount,
          contentLength: assistantContent.length,
          stream: false,
        },
      });
      generationObs.end();
    }

    if (!assistantContent && !lastAssistantMessage) {
      log.error(`[${requestId}] No assistant response received`);
      return new Response(
        JSON.stringify({ error: { type: 'api_error', message: 'No assistant response received' } }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Format response in Anthropic Messages API format
    const responseId = `msg-${Date.now()}`;
    const anthropicResponse = {
      id: responseId,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: assistantContent || 'No response content',
        },
      ],
      model: model || 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };

    log.info(`[${requestId}] Anthropic response`, {
      response: anthropicResponse,
    });   

    const totalTime = Date.now() - startTime;
    log.info(`[${requestId}] /v1/messages request completed`, {
      totalTimeMs: totalTime,
      sdkTimeMs: sdkTime,
      responseId, 
      statusCode: 200,
    });

    return new Response(JSON.stringify(anthropicResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    log.error(`[${requestId}] Error processing /v1/messages request`, {
      error: error instanceof Error ? error.message : String(error),
      totalTimeMs: totalTime,
    });
    
    return new Response(
      JSON.stringify({
        error: {
          type: 'api_error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        request_id: requestId,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Handler for /v1/chat/completions endpoint (OpenAI compatible)
async function handleChatCompletionsEndpoint(request: Request, requestId: string, startTime: number, parentTrace?: any) {

  try {
    // Parse OpenAI-compatible request
    const parseStartTime = Date.now();
    const body = (await request.json()) as {
      model?: string;
      messages?: Array<{
        role: string;
        content: string | Array<{ type: string; text: string }>;
      }>;
      max_tokens?: number;
      temperature?: number;
      stream?: boolean;
      response_format?: {
        type?: string;
        json_schema?: {
          name?: string;
          schema?: {
            type?: string;
            properties?: Record<string, any>;
            required?: string[];
            additionalProperties?: boolean;
          };
          strict?: boolean;
        };
      };
    };
    const parseTime = Date.now() - parseStartTime;
    
    const { model, messages, max_tokens, temperature, stream, response_format } = body;
    
    log.info(`[${requestId}] Request parsed`, {
      parseTimeMs: parseTime,
      model: model || '(default)',
      messageCount: messages?.length || 0,
      maxTokens: max_tokens,
      temperature: temperature,
      stream: stream,
      hasResponseFormat: !!response_format,
    });
    
    log.debug(`[${requestId}] Request body`, {
      model,
      messages: messages?.map(m => ({
        role: m.role,
        contentLength: typeof m.content === 'string' 
          ? m.content.length 
          : Array.isArray(m.content) 
            ? m.content.reduce((acc: number, block: any) => acc + (block.text?.length || 0), 0)
            : 0,
        contentType: typeof m.content === 'string' ? 'string' : 'array',
      })),
      max_tokens,
      temperature,
      stream,
    });

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      log.warn(`[${requestId}] Validation failed: messages array is required`);
      return new Response(
        JSON.stringify({ error: 'messages array is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Check if structured output is requested via response_format
    const needsStructuredOutput = !!response_format?.json_schema?.schema;
    
    // Convert OpenAI messages format to a prompt string
    // Combine all messages into a single prompt
    const promptStartTime = Date.now();
    let prompt = messages
      .map((msg: { role: string; content: string | Array<{ type: string; text: string }> }) => {
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Handle content array (e.g., text blocks)
          content = msg.content
            .filter((block: { type: string }) => block.type === 'text')
            .map((block: { type: string; text: string }) => block.text)
            .join('\n');
        }
        return `${msg.role}: ${content}`;
      })
      .join('\n\n');
    
    // Add structured output instruction if response_format is present
    if (needsStructuredOutput && response_format?.json_schema?.schema) {
      const schema = response_format.json_schema.schema;
      const schemaJson = JSON.stringify(schema, null, 2);
      prompt += `\n\nCRITICAL: You MUST provide your response according to the json schema: ${schemaJson} AND NOTHING ELSE. no back ticks, nothing. You MUST respond with valid JSON matching this schema NO MATTER WHAT - even if information appears to be missing or incomplete. If placeholders like {{query}} or {{generation}} are present, you must still respond with the JSON schema format, using your best judgment or indicating missing information within the schema structure itself. DO NOT explain that information is missing - just respond with the JSON schema format.`;
      
      log.info(`[${requestId}] Structured output instruction added to prompt`, {
        schemaProperties: Object.keys(schema.properties || {}),
        required: schema.required || [],
      });
    }
    
    const promptTime = Date.now() - promptStartTime;
    
    log.info(`[${requestId}] Prompt converted`, {
      promptTimeMs: promptTime,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
      hasStructuredOutput: needsStructuredOutput,
    });
    
    // Prepare options for the SDK
    const options = {
      maxTurns: 1,
      model: model || 'claude-sonnet-4-5',
    };
    
    log.info(`[${requestId}] Calling SDK query`, {
      options: {
        maxTurns: options.maxTurns,
        model: options.model,
      },
      promptLength: prompt.length,
    });

    // Create generation observation for LLM call
    const generationObs = parentTrace ? parentTrace.startObservation({
      name: 'claude-generation',
      asType: 'generation',
      model: options.model,
      input: {
        prompt,
        model: options.model,
        maxTurns: options.maxTurns,
        temperature,
        maxTokens: max_tokens,
        hasStructuredOutput: needsStructuredOutput,
      },
      metadata: {
        requestId,
        stream,
        needsStructuredOutput,
      },
    }) : null;

    // Call the SDK query function
    const sdkStartTime = Date.now();
    const queryResult = query({ prompt, options });
    log.debug(`[${requestId}] SDK query initiated`);

    // Handle streaming response
    if (stream) {
      log.info(`[${requestId}] Starting streaming response`);
      const responseId = `chatcmpl-${Date.now()}`;
      const modelName = model || 'claude-sonnet-4-5';
      const created = Math.floor(Date.now() / 1000);
      
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            let assistantContent = '';
            let toolOutput: any = null;
            
            for await (const message of queryResult) {
              if (message.type === 'assistant') {
                const apiMessage = message.message;
                if (apiMessage.content && Array.isArray(apiMessage.content)) {
                  // Extract text content
                  const textBlocks = apiMessage.content.filter(
                    (block: any) => block.type === 'text'
                  );
                  if (textBlocks.length > 0) {
                    const newText = textBlocks.map((block: any) => block.text).join('\n');
                    
                    if (needsStructuredOutput) {
                      // For structured output, try to parse JSON from the text
                      if (!toolOutput) {
                        try {
                          // Try to extract JSON from the text (remove any markdown code blocks if present)
                          let jsonText = newText.trim();
                          // Remove markdown code blocks if present
                          jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
                          toolOutput = JSON.parse(jsonText);
                          log.info(`[${requestId}] JSON extracted from text in stream`, {
                            toolOutput,
                          });
                        } catch (e) {
                          // If parsing fails, store the text and try again when we have more content
                          assistantContent = newText;
                        }
                      }
                    } else {
                      // Stream incremental content for non-structured output
                      const delta = newText.slice(assistantContent.length);
                      if (delta) {
                        const chunk = {
                          id: responseId,
                          object: 'chat.completion.chunk',
                          created: created,
                          model: modelName,
                          choices: [
                            {
                              index: 0,
                              delta: {
                                role: 'assistant',
                                content: delta,
                              },
                              finish_reason: null,
                            },
                          ],
                        };
                        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                      }
                      
                      assistantContent = newText;
                    }
                  }
                }
              }
            }
            
            // If structured output and we still don't have parsed JSON, try parsing the full content
            if (needsStructuredOutput && !toolOutput && assistantContent) {
              try {
                let jsonText = assistantContent.trim();
                jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
                toolOutput = JSON.parse(jsonText);
                log.info(`[${requestId}] JSON extracted from final text in stream`, {
                  toolOutput,
                });
              } catch (e) {
                log.warn(`[${requestId}] Failed to parse JSON from text in stream`, { assistantContent });
              }
            }
            
            // If structured output is requested, send tool output as content
            if (needsStructuredOutput) {
              if (!toolOutput) {
                log.error(`[${requestId}] Structured output requested but no tool output received in stream`);
                controller.error(new Error('Structured output requested but no tool output received'));
                return;
              }
              
              const toolOutputStr = JSON.stringify(toolOutput);
              // Send tool output as a single chunk
              const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: created,
                model: modelName,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: 'assistant',
                      content: toolOutputStr,
                    },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            
            // Send final chunk with finish_reason
            const finalChunk = {
              id: responseId,
              object: 'chat.completion.chunk',
              created: created,
              model: modelName,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
            
            // Send [DONE] marker
            controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
            
            const sdkTime = Date.now() - sdkStartTime;
            const totalTime = Date.now() - startTime;
            log.info(`[${requestId}] Streaming completed`, {
              totalTimeMs: totalTime,
              sdkTimeMs: sdkTime,
              responseId,
              hasToolOutput: !!toolOutput,
            });
            
            // Update generation observation for streaming
            if (generationObs) {
              generationObs.update({
                output: needsStructuredOutput ? toolOutput : assistantContent,
                metadata: {
                  responseId,
                  contentLength: assistantContent.length,
                  stream: true,
                  hasToolOutput: !!toolOutput,
                },
              });
              generationObs.end();
            }
            
            controller.close();
          } catch (error) {
            log.error(`[${requestId}] Streaming error`, error);
            controller.error(error);
          }
        },
      });
      
      return new Response(streamResponse, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming response
    // Collect assistant messages
    let assistantContent = '';
    let toolOutput: any = null;
    let lastAssistantMessage: any = null;
    let messageCount = 0;
    let assistantMessageCount = 0;
    const messageTypes: Record<string, number> = {};

    log.debug(`[${requestId}] Starting to process SDK messages`);
    
    for await (const message of queryResult) {
      messageCount++;
      const messageType = message.type;
      messageTypes[messageType] = (messageTypes[messageType] || 0) + 1;
      
      log.debug(`[${requestId}] Received message ${messageCount}`, {
        type: messageType,
        hasMessage: 'message' in message,
      });
      
      if (message.type === 'assistant') {
        assistantMessageCount++;
        lastAssistantMessage = message;
        log.info(`[${requestId}] Assistant message received`, {
          messageNumber: assistantMessageCount,
          sessionId: message.session_id,
          uuid: message.uuid,
        });
        
        // Extract content from the assistant message
        const apiMessage = message.message;
        if (apiMessage.content && Array.isArray(apiMessage.content)) {
          // Extract text content
          const textBlocks = apiMessage.content.filter(
            (block: any) => block.type === 'text'
          );
          if (textBlocks.length > 0) {
            const textContent = textBlocks.map((block: any) => block.text).join('\n');
            
            if (needsStructuredOutput) {
              // For structured output, try to parse JSON from the text
              if (!toolOutput) {
                try {
                  // Try to extract JSON from the text (remove any markdown code blocks if present)
                  let jsonText = textContent.trim();
                  // Remove markdown code blocks if present
                  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
                  toolOutput = JSON.parse(jsonText);
                  log.info(`[${requestId}] JSON extracted from text`, {
                    toolOutput,
                  });
                } catch (e) {
                  // If parsing fails, accumulate text and try again later
                  assistantContent += (assistantContent ? '\n' : '') + textContent;
                }
              }
            } else {
              // For non-structured output, accumulate text content
              assistantContent = textContent;
              log.debug(`[${requestId}] Extracted assistant content`, {
                contentLength: assistantContent.length,
                textBlockCount: textBlocks.length,
                contentPreview: assistantContent.substring(0, 200) + (assistantContent.length > 200 ? '...' : ''),
              });
            }
          }
        }
      }
    }
    
    const sdkTime = Date.now() - sdkStartTime;
    
    // Update generation observation for non-streaming
    if (generationObs) {
      generationObs.update({
        output: needsStructuredOutput ? toolOutput : assistantContent,
        metadata: {
          messageCount,
          assistantMessageCount,
          contentLength: assistantContent.length,
          stream: false,
          hasToolOutput: !!toolOutput,
          messageTypes,
        },
      });
      generationObs.end();
    }
    
    // If structured output and we still don't have parsed JSON, try parsing the accumulated content
    if (needsStructuredOutput && !toolOutput && assistantContent) {
      try {
        let jsonText = assistantContent.trim();
        jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        toolOutput = JSON.parse(jsonText);
        log.info(`[${requestId}] JSON extracted from final accumulated text`, {
          toolOutput,
        });
      } catch (e) {
        log.warn(`[${requestId}] Failed to parse JSON from accumulated text`, { assistantContent });
      }
    }
    
    log.info(`[${requestId}] SDK query completed`, {
      sdkTimeMs: sdkTime,
      totalMessages: messageCount,
      assistantMessages: assistantMessageCount,
      messageTypes,
      hasContent: !!assistantContent,
      hasToolOutput: !!toolOutput,
      contentLength: assistantContent.length,
    });

    // If structured output is requested, return only the parsed JSON
    if (needsStructuredOutput) {
      if (!toolOutput) {
        log.error(`[${requestId}] Structured output requested but no valid JSON received`, {
          totalMessages: messageCount,
          messageTypes,
          assistantContent: assistantContent.substring(0, 500),
        });
        return new Response(
          JSON.stringify({ error: 'Structured output requested but no valid JSON received' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      
      log.info(`[${requestId}] Returning structured tool output only`);
      
      // Format response with tool output as content
      const responseStartTime = Date.now();
      const responseId = `chatcmpl-${Date.now()}`;
      const openAIResponse = {
        id: responseId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'claude-sonnet-4-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify(toolOutput),
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      };
      
      const totalTime = Date.now() - startTime;
      log.info(`[${requestId}] Structured output response completed`, {
        totalTimeMs: totalTime,
        responseId,
        toolOutput,
      });
      
      return new Response(JSON.stringify(openAIResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // If no assistant content found, return error
    if (!assistantContent && !lastAssistantMessage) {
      log.error(`[${requestId}] No assistant response received`, {
        totalMessages: messageCount,
        messageTypes,
      });
      return new Response(
        JSON.stringify({ error: 'No assistant response received' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Format response in OpenAI-compatible format (normal response)
    const responseStartTime = Date.now();
    const responseId = `chatcmpl-${Date.now()}`;
    const openAIResponse = {
      id: responseId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: model || 'claude-sonnet-4-5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: assistantContent || 'No response content',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0, // SDK doesn't provide this directly
        completion_tokens: 0, // SDK doesn't provide this directly
        total_tokens: 0,
      },
    };
    const responseTime = Date.now() - responseStartTime;
    const totalTime = Date.now() - startTime;

    log.info(`[${requestId}] Response formatted`, {
      responseTimeMs: responseTime,
      responseId,
      contentLength: assistantContent.length,
      model: openAIResponse.model,
    });

    log.info(`[${requestId}] Request completed successfully`, {
      totalTimeMs: totalTime,
      parseTimeMs: parseTime,
      promptTimeMs: promptTime,
      sdkTimeMs: sdkTime,
      responseTimeMs: responseTime,
      responseId,
      statusCode: 200,
    });

    return new Response(JSON.stringify(openAIResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    log.error(`[${requestId}] Error processing request`, {
      error: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      totalTimeMs: totalTime,
    });
    
    if (error instanceof Error) {
      log.error(`[${requestId}] Error stack trace`, error.stack);
    }
    
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

log.info(`OpenAI-compatible proxy server started`, {
  port: server.port,
  url: `http://localhost:${server.port}`,
  description: 'This server accepts OpenAI-compatible requests and forwards them to Claude using the Agent SDK',
});

