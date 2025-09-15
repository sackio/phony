# Usage Guide

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Set environment variables (see `.env.example`).
   To change the assistant's voice, set `OPENAI_VOICE` to an OpenAI voice name such as `alloy` or `aria`.

3. Start the API:
   ```bash
   uvicorn backend.main:app --reload
   ```

4. Initiate a call using the helper script:
   ```bash
   python scripts/make_call.py +15551234567
   ```

Refer to `README.md` for full details on available endpoints and dashboard usage.
