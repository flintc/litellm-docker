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
      "content": "How factual is the generation: The capital of France is Paris. Paris was established in 1990"
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

