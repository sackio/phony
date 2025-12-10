import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { CallPage } from './pages/CallPage';
import { CallsListPage } from './pages/CallsListPage';
import { IncomingConfigsPage } from './pages/IncomingConfigsPage';
import { ContextsPage } from './pages/ContextsPage';
import { SendSmsPage } from './pages/SendSmsPage';
import { ConversationPage } from './pages/ConversationPage';
import { ConversationsListPage } from './pages/ConversationsListPage';
import { GroupConversationPage } from './pages/GroupConversationPage';
import './App.css';

function AppContent() {
  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h1>📞 Phony</h1>
          </Link>
        </div>
        <div className="navbar-links">
          <Link to="/" className="nav-link">New Call</Link>
          <Link to="/calls" className="nav-link">Call History</Link>
          <Link to="/sms/send" className="nav-link">Send SMS</Link>
          <Link to="/sms/messages" className="nav-link">Messages</Link>
          <Link to="/incoming" className="nav-link">Incoming Calls</Link>
          <Link to="/contexts" className="nav-link">Contexts</Link>
        </div>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/calls" element={<CallsListPage />} />
          <Route path="/call/:callSid" element={<CallPage />} />
          <Route path="/sms/send" element={<SendSmsPage />} />
          <Route path="/sms/messages" element={<ConversationsListPage />} />
          <Route path="/sms/conversation/:phoneNumber" element={<ConversationPage />} />
          <Route path="/sms/conversations/:conversationId" element={<GroupConversationPage />} />
          <Route path="/incoming" element={<IncomingConfigsPage />} />
          <Route path="/contexts" element={<ContextsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
