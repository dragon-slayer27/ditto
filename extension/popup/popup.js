const $ = (id) => document.getElementById(id);

function setRow(dotId, textId, kind, html) {
  $(dotId).className = `dot ${kind}`;
  $(textId).innerHTML = html;
}

function showError(html) {
  const box = $('error');
  box.innerHTML = html;
  box.hidden = false;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function run(what) {
  const tab = await activeTab();
  if (!tab || !/^(https?|file):/.test(tab.url || '')) {
    showError("Ditto can't run on this kind of page (browser settings, the Web Store or PDFs). Open a normal web form.");
    return;
  }
  const res = await chrome.runtime.sendMessage({ cmd: 'run', what, tabId: tab.id });
  if (res && res.ok) window.close();
  else showError(`Could not start on this page: ${res ? res.error : 'unknown error'}`);
}

async function init() {
  $('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('fill').addEventListener('click', () => run('fill'));
  $('learn').addEventListener('click', () => run('learn'));

  const s = await chrome.runtime.sendMessage({ cmd: 'status' });
  if (!s || !s.ok) {
    showError('Ditto could not start. Try reloading the extension.');
    return;
  }

  if (!s.ollama) {
    setRow('ollama-dot', 'ollama-text', 'bad', 'Ollama is not running. Open the Ollama app or run <code>ollama serve</code>.');
  } else if (!s.model) {
    setRow('ollama-dot', 'ollama-text', 'bad', 'No model yet. Run <code>ollama pull gemma4:e4b</code>.');
  } else {
    setRow('ollama-dot', 'ollama-text', s.loaded ? 'ok' : 'warn', `${s.modelName} ${s.loaded ? 'is awake' : 'is asleep (the first fill wakes it, about a minute)'}`);
    if (!s.loaded) chrome.runtime.sendMessage({ cmd: 'warmup' });
  }

  if (s.facts) setRow('profile-dot', 'profile-text', 'ok', `Your profile has ${s.facts} facts, stored on this computer.`);
  else setRow('profile-dot', 'profile-text', 'warn', 'Your profile is empty. <a href="#" id="setup">Set it up in 2 minutes</a>.');
  const setup = $('setup');
  if (setup)
    setup.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

  $('learn').disabled = !(s.ollama && s.model);
  $('fill').disabled = !(s.ollama && s.model && s.facts);
}

init();
