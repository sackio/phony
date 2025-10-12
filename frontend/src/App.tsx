import { HomePage } from './pages/HomePage';
import './App.css';

function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <div className="navbar-brand">
          <h1>📞 Voice Call Manager</h1>
        </div>
      </nav>

      <main className="main-content">
        <HomePage />
      </main>
    </div>
  );
}

export default App;
