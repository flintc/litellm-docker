#!/bin/bash

# Test curl request to OpenAI proxy
curl -X POST http://localhost:5004/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
  "model": "claude-sonnet-4-5",
  "stream": false,
  "messages": [
    {
      "role": "user",
      "content": "Evaluate the correctness of the generation on a continuous scale from 0 to 1. A generation can be considered correct (Score: 1) if every fact presented in the generation is factually supported by common sense, mathematics and/or your knowledge base.\n\nExample:\nQuery: Can eating carrots improve your vision?\nGeneration: Yes, eating carrots significantly improves your vision, especially at night. This is why people who eat lots of carrots never need glasses. Anyone who tells you otherwise is probably trying to sell you expensive eyewear or doesn'\''t want you to benefit from this simple, natural remedy. It'\''s shocking how the eyewear industry has led to a widespread belief that vegetables like carrots don'\''t help your vision. People are so gullible to fall for these money-making schemes.\nScore: 0.1\nReasoning: While the generation mentions that carrots can improve vision, it fails to outline the reason for this phenomenon and the circumstances under which this is the case. The rest of the response contains misinformation and exaggerations regarding the benefits of eating carrots for vision improvement.\n\nInput:\nQuery: {{query}}\nGeneration: {{generation}}\n\nThink step by step."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "extract",
      "schema": {
        "type": "object",
        "$schema": "http://json-schema.org/draft-07/schema#",
        "required": [
          "score",
          "reasoning"
        ],
        "properties": {
          "score": {
            "type": "string"
          },
          "reasoning": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "strict": true
    }
  }
}'

