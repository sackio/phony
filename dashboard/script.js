const {
  Box,
  Button,
  TextField,
  Typography,
  Container,
  AppBar,
  Toolbar,
  Paper,
  ThemeProvider,
  createTheme,
  CssBaseline,
} = MaterialUI;

function App() {
  const params = new URLSearchParams(window.location.search);
  const callSid = params.get('callSid');
  if (!callSid) {
    return <Typography color="error" sx={{ p: 2 }}>callSid query parameter required</Typography>;
  }

  const [lines, setLines] = React.useState([]);
  const [speak, setSpeak] = React.useState('');
  const [queryPrompt, setQueryPrompt] = React.useState('');
  const [queryText, setQueryText] = React.useState('');
  const [showQuery, setShowQuery] = React.useState(false);
  const [feedbackText, setFeedbackText] = React.useState('');
  const [showFeedback, setShowFeedback] = React.useState(false);

  React.useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/events/ws?callSid=${callSid}`);

    const addLine = (text) => setLines((prev) => [...prev, text]);
    const formatTime = (ts) => {
      try {
        return new Date(ts).toLocaleTimeString();
      } catch (e) {
        return '';
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const time = formatTime(data.timestamp);
      if (data.type === 'transcript') {
        addLine(`[${time}] Caller: ${data.text}`);
      } else if (data.type === 'assistant_response') {
        addLine(`[${time}] Assistant: ${data.text}`);
      } else if (data.type === 'command_executed') {
        addLine(`[${time}] Command: ${data.command} ${data.value || ''}`);
      } else if (data.type === 'query') {
        addLine(`[${time}] AI is waiting for your input: ${data.prompt}`);
        setQueryPrompt(data.prompt);
        setShowQuery(true);
      } else if (data.type === 'query_response') {
        addLine(`[${time}] Supervisor answered: ${data.text}`);
      } else if (data.type === 'pending_response') {
        addLine(`[${time}] Pending assistant reply: ${data.text}`);
        setFeedbackText(data.text || '');
        setShowFeedback(true);
      } else {
        addLine(`[${time}] ${data.type}`);
      }
    };

    ws.onclose = () => {
      addLine('Connection closed');
    };

    return () => ws.close();
  }, [callSid]);

  const handleSpeak = (e) => {
    e.preventDefault();
    const text = speak.trim();
    if (!text) return;
    setLines((prev) => [...prev, `Supervisor typed: ${text}`]);
    fetch('/override/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, text }),
    });
    setSpeak('');
  };

  const handleDigit = (k) => {
    setLines((prev) => [...prev, `Supervisor pressed: ${k}`]);
    fetch('/override/dtmf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, digit: k }),
    });
  };

  const handleEndCall = () => {
    setLines((prev) => [...prev, 'Supervisor ended the call']);
    fetch('/override/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid }),
    });
  };

  const handleTransfer = () => {
    const number = prompt('Transfer to phone number:');
    if (!number) return;
    setLines((prev) => [...prev, `Supervisor transfer to: ${number}`]);
    fetch('/override/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, number }),
    });
  };

  const handleQuerySubmit = (e) => {
    e.preventDefault();
    const text = queryText.trim();
    if (!text) return;
    setLines((prev) => [...prev, `Supervisor answered: ${text}`]);
    fetch('/override/clarification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, response: text }),
    });
    setQueryText('');
    setShowQuery(false);
  };

  const handleFeedbackSubmit = (e) => {
    e.preventDefault();
    const text = feedbackText.trim();
    if (!text) return;
    setLines((prev) => [...prev, `Supervisor approved: ${text}`]);
    fetch('/override/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, text }),
    });
    setFeedbackText('');
    setShowFeedback(false);
  };

  const theme = createTheme();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">Phony Call Dashboard</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 2 }}>
        <Paper elevation={3} sx={{ p: 2, mb: 2, height: 300, overflowY: 'auto' }}>
          {lines.map((line, i) => (
            <Typography key={i} variant="body2">{line}</Typography>
          ))}
        </Paper>

        {showQuery && (
          <Paper elevation={2} sx={{ p: 2, mb: 2, backgroundColor: '#fff8e1' }}>
            <Typography sx={{ mb: 1 }}>{queryPrompt}</Typography>
            <Box component="form" onSubmit={handleQuerySubmit} sx={{ display: 'flex', gap: 1 }}>
              <TextField value={queryText} onChange={(e) => setQueryText(e.target.value)} fullWidth />
              <Button type="submit" variant="contained">Answer</Button>
            </Box>
          </Paper>
        )}

        {showFeedback && (
          <Paper elevation={2} sx={{ p: 2, mb: 2 }}>
            <Typography sx={{ mb: 1 }}>Review assistant reply:</Typography>
            <Box component="form" onSubmit={handleFeedbackSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <TextField
                multiline
                minRows={3}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                fullWidth
              />
              <Button type="submit" variant="contained">Send</Button>
            </Box>
          </Paper>
        )}

        <Box component="form" onSubmit={handleSpeak} sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            placeholder="Type message"
            value={speak}
            onChange={(e) => setSpeak(e.target.value)}
            fullWidth
          />
          <Button type="submit" variant="contained">Send</Button>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, mb: 2 }}>
          {['1','2','3','4','5','6','7','8','9','*','0','#'].map((k) => (
            <Button key={k} variant="outlined" onClick={() => handleDigit(k)}>{k}</Button>
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" color="error" onClick={handleEndCall}>End Call</Button>
          <Button variant="contained" color="secondary" onClick={handleTransfer}>Transfer</Button>
        </Box>
      </Container>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
