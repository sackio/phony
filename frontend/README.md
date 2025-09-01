# Phony React Frontend

Modern React dashboard for the Phony Voice AI Agent Management System.

## Features

- **Material-UI Design System** - Professional, responsive interface
- **Real-time Agent Management** - Create, edit, and manage AI agents
- **Phone Number Assignment** - Visual phone number management
- **Active Call Monitoring** - Live call tracking and context editing
- **Analytics Dashboard** - Performance metrics and reporting
- **TypeScript** - Full type safety throughout the application

## Quick Start

### Development Mode

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server
npm start

# App will be available at http://localhost:3000
# API requests proxy to http://localhost:24187
```

### Production Build

```bash
# Build for production
npm run build

# Or use the provided script from project root
./build-frontend.sh
```

### Docker Build

```bash
# From project root
docker-compose up frontend-build
```

## Project Structure

```
frontend/
├── public/                 # Static assets
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── Layout/         # Navigation and layout
│   │   └── AgentCard/      # Agent display component
│   ├── pages/              # Route-specific pages
│   │   ├── Dashboard/      # Overview dashboard
│   │   ├── Agents/         # Agent management
│   │   ├── ActiveCalls/    # Live call monitoring
│   │   ├── PhoneNumbers/   # Number management
│   │   ├── Analytics/      # Reports and metrics
│   │   └── dialogs/        # Modal dialogs
│   ├── services/           # API integration
│   │   └── api.ts         # Agent API client
│   ├── types/              # TypeScript definitions
│   │   └── Agent.ts       # Data models
│   ├── theme.ts           # Material-UI theme
│   ├── App.tsx            # Main app component
│   └── index.tsx          # Entry point
├── package.json           # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Key Components

### Layout
- **Navigation Drawer** - Responsive sidebar with route navigation
- **App Bar** - Page titles and mobile menu toggle
- **Material-UI Theming** - Consistent design system

### Agent Management
- **Agent Cards** - Visual agent representation with actions
- **Agent Dialog** - Create/edit agent form with validation
- **Context Dialog** - Real-time context editing
- **Phone Assignment** - Visual phone number management

### Real-time Features
- **Active Calls** - Live call monitoring with updates
- **Context Updates** - Edit agent context during calls
- **Statistics** - Real-time metrics and performance data

### API Integration
- **Type-safe API Client** - Full TypeScript integration
- **Error Handling** - Comprehensive error management
- **Loading States** - User-friendly loading indicators
- **Automatic Retries** - Robust API communication

## API Endpoints Used

The frontend integrates with all backend API endpoints:

- `GET /agents/` - List all agents
- `POST /agents/` - Create new agent
- `PUT /agents/{id}` - Update agent
- `DELETE /agents/{id}` - Delete agent
- `GET /agents/{id}/context` - Get agent context
- `PUT /agents/{id}/context` - Update agent context
- `GET /agents/phone-numbers/available` - Available phone numbers
- `POST /agents/phone-numbers/assign` - Assign phone number
- `GET /agents/calls/active` - Active calls
- `POST /agents/calls/{call_sid}/context` - Update call context
- `POST /agents/call/outbound` - Make outbound call

## Material-UI Theme

Custom theme with:
- **Primary Color**: Blue (#1976d2)
- **Secondary Color**: Pink (#dc004e)
- **Success**: Green (#2e7d32)
- **Typography**: Roboto font family
- **Shape**: 8px border radius
- **Custom Components**: Styled buttons, cards, and chips

## TypeScript Types

Comprehensive type definitions for:
- **Agent** - Complete agent model
- **CallContext** - Dynamic call context
- **PhoneNumber** - Twilio phone number data
- **CallSession** - Active and completed calls
- **API Requests/Responses** - All API communication

## Development

### Adding New Pages

1. Create page component in `src/pages/NewPage/`
2. Add route to `src/App.tsx`
3. Add navigation item to `src/components/Layout/Layout.tsx`

### API Integration

1. Add types to `src/types/Agent.ts`
2. Add API methods to `src/services/api.ts`
3. Use in components with proper error handling

### Styling

- Use Material-UI components and sx prop
- Follow theme color scheme
- Maintain responsive design patterns
- Use consistent spacing and typography

## Browser Support

- **Chrome/Chromium** - Latest 2 versions
- **Firefox** - Latest 2 versions  
- **Safari** - Latest 2 versions
- **Edge** - Latest 2 versions

## Performance

- **Code Splitting** - Automatic route-based splitting
- **Tree Shaking** - Dead code elimination
- **Optimized Builds** - Production-ready builds
- **Caching** - Browser caching for static assets

The React frontend provides a modern, professional interface for managing voice AI agents with real-time capabilities and comprehensive functionality.