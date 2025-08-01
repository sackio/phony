(function () {
  const params = new URLSearchParams(window.location.search);
  const callSid = params.get('callSid');
  if (!callSid) {
    alert('callSid query parameter required');
    return;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}/events/ws?callSid=${callSid}`);

  const transcript = document.getElementById('transcript');

  function addLine(text) {
    const div = document.createElement('div');
    div.textContent = text;
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch (e) {
      return '';
    }
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const time = formatTime(data.timestamp);
    if (data.type === 'transcript') {
      addLine(`[${time}] Caller: ${data.text}`);
    } else if (data.type === 'assistant_response') {
      addLine(`[${time}] Assistant: ${data.text}`);
    } else if (data.type === 'command_executed') {
      addLine(`[${time}] Command: ${data.command} ${data.value || ''}`);
    } else {
      addLine(`[${time}] ${data.type}`);
    }
  };

  ws.onclose = () => {
    addLine('Connection closed');
  };

  document.getElementById('speak-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('speak-input');
    const text = input.value.trim();
    if (!text) return;
    addLine(`Supervisor typed: ${text}`);
    fetch('/override/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, text }),
    });
    input.value = '';
  });

  const keypad = document.getElementById('keypad');
  const keys = ['1','2','3','4','5','6','7','8','9','*','0','#'];
  keys.forEach(k => {
    const btn = document.createElement('button');
    btn.textContent = k;
    btn.dataset.digit = k;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      addLine(`Supervisor pressed: ${k}`);
      fetch('/override/dtmf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callSid, digit: k }),
      });
    });
    keypad.appendChild(btn);
  });

  document.getElementById('end-call').addEventListener('click', () => {
    addLine('Supervisor ended the call');
    fetch('/override/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid }),
    });
  });

  document.getElementById('transfer').addEventListener('click', () => {
    const number = prompt('Transfer to phone number:');
    if (!number) return;
    addLine(`Supervisor transfer to: ${number}`);
    fetch('/override/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid, number }),
    });
  });
})();
