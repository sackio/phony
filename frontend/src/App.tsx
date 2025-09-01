import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { theme } from './theme';
import { Layout } from './components/Layout/Layout';
import { AgentsPage } from './pages/Agents/AgentsPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { PhoneNumbersPage } from './pages/PhoneNumbers/PhoneNumbersPage';
import { ActiveCallsPage } from './pages/ActiveCalls/ActiveCallsPage';
import { AnalyticsPage } from './pages/Analytics/AnalyticsPage';

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/phone-numbers" element={<PhoneNumbersPage />} />
            <Route path="/calls" element={<ActiveCallsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Router>
    </ThemeProvider>
  );
}

export default App;