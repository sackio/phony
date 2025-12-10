# Voice Call Manager - Frontend

React-based web UI for managing outbound AI voice calls with OpenAI Realtime API.

## Features

- **Make Outbound Calls**: Enter phone number and call context to initiate AI-powered calls
- **Voice Selection**: Choose from 7 OpenAI voices (alloy, echo, fable, onyx, nova, shimmer, sage)
- **Custom Instructions**: Full control over AI behavior via call context textarea
- **Real-time Feedback**: See call status and SID immediately after initiating

## Quick Start

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your API_SECRET and API_URL

# Start development server
npm run dev
```

The frontend will be available at http://localhost:3005/

## Environment Variables

- `VITE_API_URL`: Backend URL (default: http://localhost:3004)
- `VITE_API_SECRET`: API secret for backend authentication (must match backend .env)

## Tech Stack

- React 18 + TypeScript
- Vite (fast dev server + build)
- TanStack React Query (data fetching)
- Axios (HTTP client)

## How It Works

1. User fills out the form with phone number, voice, and call context
2. Frontend sends POST request to `/call/outgoing` endpoint with query params
3. Backend initiates Twilio call with custom TwiML that connects to OpenAI
4. User receives feedback with Call SID and status

## Development

```bash
npm run dev      # Start dev server (port 3005)
npm run build    # Build for production
npm run preview  # Preview production build
```
