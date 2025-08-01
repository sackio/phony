# LLM Command Syntax

The assistant can embed special tokens in its responses. These commands are
detected server side and executed without speaking the text verbatim.

- `[[press:digits]]` – send DTMF tones to the caller
- `[[transfer:number]]` – transfer the call and end the session
- `[[end_call]]` – terminate the call
- `[[request_user:prompt]]` – pause and ask the supervisor for a response

Only include the command tokens exactly as shown. Any additional text will be
spoken to the caller.
