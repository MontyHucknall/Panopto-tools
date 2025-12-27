// popup.js
// Controls tab switching, transcript extraction, stream list UI, and local A/V combining.

///// --- Tabs UI --- /////
const tabBtns = {
    transcripts: document.getElementById('tab-transcripts'),
    streams: document.getElementById('tab-streams'),
    combine: document.getElementById('tab-combine')
  };
  const panels = {
    transcripts: document.getElementById('panel-transcripts'),
    streams: document.getElementById('panel-streams'),
    combine: document.getElementById('panel-combine')
  };
  function setActive(tab) {
    for (const k in tabBtns) {
      tabBtns[k].classList.toggle('active', k === tab);
      panels[k].classList.toggle('active', k === tab);
    }
  }
  tabBtns.transcripts.addEventListener('click', () => setActive('transcripts'));
  tabBtns.streams.addEventListener('click', () => setActive('streams'));
  tabBtns.combine.addEventListener('click', () => setActive('combine'));
  
  ///// --- Transcripts logic --- /////
  const extractBtn = document.getElementById('extractTrans');
  const removeTimestampsCheckbox = document.getElementById('removeTimestamps');
  const transStatus = document.getElementById('transExportStatus');
  const openTranscriptTabBtn = document.getElementById('openTranscriptTab');
  
  extractBtn.addEventListener('click', async () => {
    transStatus.textContent = 'Requesting transcript from page...';
    const removeTS = !!removeTimestampsCheckbox.checked;
  
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { transStatus.textContent = 'No active tab.'; return; }
  
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(removeTimestamps) {
          function collectText(root = document) {
            const sel = [
              '#dockedCaptionText',
              '.transcript-text',
              '.caption-text',
              '[class*="transcript"]',
              '[aria-label*="Transcript"]',
              '.css-1p4tz9d'
            ];
            const found = [];
            sel.forEach(s => {
              try {
                (root.querySelectorAll(s) || []).forEach(el => {
                  const t = (el.textContent || '').trim();
                  if (t && !/auto-?generated captions/i.test(t)) found.push(t);
                });
              } catch(e){}
            });
            if (!found.length) {
              const candidates = Array.from(document.querySelectorAll('[role="region"], [aria-label]'));
              candidates.forEach(c => {
                try {
                  const label = (c.getAttribute && (c.getAttribute('aria-label') || '')).toLowerCase();
                  if (label.includes('transcript') || (c.textContent || '').toLowerCase().includes('auto-generated captions')) {
                    Array.from(c.querySelectorAll('*')).forEach(n => {
                      if (n.children.length === 0) {
                        const t = (n.textContent || '').trim();
                        if (t && !/auto-?generated captions/i.test(t)) found.push(t);
                      }
                    });
                  }
                } catch(e){}
              });
            }
            return found;
          }
  
          let lines = collectText(document);
          if (!lines.length) {
            try {
              Array.from(document.querySelectorAll('video')).forEach(v => {
                try {
                  if (v.textTracks && v.textTracks.length) {
                    for (let i=0;i<v.textTracks.length;i++){
                      const cues = v.textTracks[i].cues || [];
                      for (let j=0;j<cues.length;j++){
                        const txt = (cues[j] && cues[j].text) ? cues[j].text.trim() : '';
                        if (txt) lines.push(txt);
                      }
                    }
                  }
                } catch(e){}
              });
            } catch(e){}
          }
  
          const cleaned = lines.map(s => s.replace(/\u00A0/g,' ').trim())
            .map(s => removeTimestamps ? s.replace(/\b\d{1,2}:\d{2}\b/g,'').replace(/\s+/g,' ').trim() : s)
            .filter(s => s.length > 0 && !/retry\s+cancel/i.test(s));
  
          if (!cleaned.length) {
            alert('No transcript/captions found on the page. Make sure the transcript panel is visible.');
            return { success: false, message: 'no-data' };
          }
  
          const text = cleaned.join('\n');
          const blob = new Blob([text], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'panopto_transcript.txt';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(()=>URL.revokeObjectURL(url), 30000);
          return { success: true, lines: cleaned.length };
        },
        args: [removeTS]
      });
      transStatus.textContent = 'Transcript exported (download should start).';
    } catch (err) {
      console.error(err);
      transStatus.textContent = 'Error extracting transcript: ' + (err && err.message ? err.message : err);
    }
  });
  
  openTranscriptTabBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) chrome.tabs.create({ url: tab.url });
  });
  
  ///// --- Streams logic --- /////
  const refreshStreamsBtn = document.getElementById('refreshStreams');
  const clearStreamsBtn = document.getElementById('clearStreams');
  const showAllStreamsBtn = document.getElementById('showAllStreams');
  const streamsListDiv = document.getElementById('streamsList');
  const streamsStatus = document.getElementById('streamsStatus');
  
  async function refreshStreams() {
    streamsStatus.textContent = 'Refreshing...';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab ? tab.id : null;
  
    chrome.runtime.sendMessage({ type: 'getCapturedForTab', tabId }, (resp) => {
      if (!resp || !resp.ok) {
        streamsListDiv.innerHTML = '<div class="small">No captured data.</div>';
        streamsStatus.textContent = '';
        return;
      }
  
      const items = resp.list || [];
      const fallback = resp.fallback || [];
      const combined = Array.from(new Set([...(items || []), ...(fallback || [])]));
  
      // persist URLs in storage for later popup reopening
      if (combined.length) {
        chrome.storage.local.set({ lastCapturedForPopup: combined });
      }
  
      renderStreams(items, fallback);
      streamsStatus.textContent = `Found ${combined.length} total URLs (saved).`;
    });
  }
  
  function renderStreams(list, fallback) {
    const arr = Array.from(new Set([...(list || []), ...(fallback || [])]));
    if (!arr.length) {
      streamsListDiv.innerHTML = '<div class="small">No URLs captured yet. Play the video and press Refresh.</div>';
      return;
    }
    const container = document.createElement('div');
    arr.forEach(url => {
      const block = document.createElement('div');
      block.className = 'url-item';
      const u = document.createElement('div');
      u.textContent = url;
      block.appendChild(u);
      const actions = document.createElement('div');
      actions.className = 'actions';
  
      const openBtn = document.createElement('button');
      openBtn.className = 'action muted';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => chrome.tabs.create({ url }));
  
      const copyBtn = document.createElement('button');
      copyBtn.className = 'action';
      copyBtn.textContent = 'Copy ffmpeg';
      copyBtn.addEventListener('click', async () => {
        const cmd = `ffmpeg -i "${url}" -c copy "panopto_output.mp4"`;
        try {
          await navigator.clipboard.writeText(cmd);
          streamsStatus.textContent = 'Copied ffmpeg command to clipboard.';
        } catch (e) {
          streamsStatus.textContent = 'ffmpeg command: ' + cmd;
        }
      });
  
      const dlBtn = document.createElement('button');
      dlBtn.className = 'action';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => {
        chrome.downloads.download({ url, filename: suggestFilename(url) }, (id) => {
          if (chrome.runtime.lastError) streamsStatus.textContent = `Failed: ${chrome.runtime.lastError.message}`;
          else streamsStatus.textContent = `Download started (id ${id})`;
        });
      });
  
      actions.appendChild(copyBtn);
      actions.appendChild(openBtn);
      actions.appendChild(dlBtn);
      block.appendChild(actions);
      container.appendChild(block);
    });
    streamsListDiv.innerHTML = '';
    streamsListDiv.appendChild(container);
  }
  
  function suggestFilename(url) {
    try {
      const u = new URL(url);
      let name = decodeURIComponent(u.pathname.split('/').pop() || 'panopto');
      name = name.replace(/[?#].*$/, '');
      if (!/\.(mp4|mkv|webm|ts|mpd|m3u8)$/i.test(name)) name += '.mp4';
      return name;
    } catch {
      return 'panopto_output.mp4';
    }
  }
  
  refreshStreamsBtn.addEventListener('click', refreshStreams);
  clearStreamsBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { streamsStatus.textContent = 'No active tab.'; return; }
    chrome.runtime.sendMessage({ type: 'clearCapturedForTab', tabId: tab.id }, () => {
      streamsStatus.textContent = 'Cleared captured URLs for this tab.';
      chrome.storage.local.remove('lastCapturedForPopup');
      refreshStreams();
    });
  });
  showAllStreamsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'getAllCaptured' }, (resp) => {
      if (!resp || !resp.capturedByTab) { streamsListDiv.innerHTML = 'No data'; return; }
      const map = resp.capturedByTab;
      let out = '';
      for (const tid in map) {
        out += `Tab ${tid}:\n${map[tid].join('\n')}\n\n`;
      }
      streamsListDiv.innerHTML = `<pre class="small">${out}</pre>`;
    });
  });
  
  // Restore last captured URLs when popup reopens
  chrome.storage.local.get('lastCapturedForPopup', (data) => {
    const saved = data.lastCapturedForPopup || [];
    if (saved.length) {
      renderStreams(saved, []);
      streamsStatus.textContent = `Restored ${saved.length} saved URLs from last session.`;
    } else {
      streamsStatus.textContent = 'No saved URLs yet. Play the video and press Refresh.';
    }
  });
  
  ///// --- Combine A/V logic --- /////
  const videoFileInput = document.getElementById('videoFile');
  const audioFileInput = document.getElementById('audioFile');
  const videoUrlInput = document.getElementById('videoUrl');
  const audioUrlInput = document.getElementById('audioUrl');
  const combineStartBtn = document.getElementById('combineStart');
  const combineStopBtn = document.getElementById('combineStop');
  const combineStatus = document.getElementById('combineStatus');
  const videoOnlyCheckbox = document.getElementById('videoOnly');
  
  let mediaRecorder = null;
  let recordedChunks = [];
  let combinedStream = null;
  let videoEl = null;
  let audioEl = null;
  let audioContext = null;
  let audioDestination = null;
  
  function setCombineStatus(t) { combineStatus.textContent = 'Status: ' + t; }
  
  function getSourceUrl(fileInput, urlInput) {
    const f = fileInput.files && fileInput.files[0];
    if (f) return URL.createObjectURL(f);
    const txt = urlInput.value && urlInput.value.trim();
    if (txt) return txt;
    return null;
  }
  
  async function prepareElements(videoSrc, audioSrc) {
    if (videoEl) { try { videoEl.pause(); videoEl.src=''; videoEl.remove(); } catch(e){} videoEl = null; }
    if (audioEl) { try { audioEl.pause(); audioEl.src=''; audioEl.remove(); } catch(e){} audioEl = null; }
  
    videoEl = document.createElement('video');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.crossOrigin = "anonymous";
    videoEl.src = videoSrc;
    videoEl.style.display = 'none';
    document.body.appendChild(videoEl);
  
    audioEl = document.createElement('audio');
    audioEl.crossOrigin = "anonymous";
    audioEl.src = audioSrc || '';
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
  
    await Promise.all([
      new Promise(res => { if (videoEl.readyState >= 1) return res(); videoEl.onloadedmetadata = () => res(); }),
      new Promise(res => { if (!audioEl || !audioSrc) return res(); if (audioEl.readyState >= 1) return res(); audioEl.onloadedmetadata = () => res(); })
    ]);
  }
  
  async function startCombine() {
    setCombineStatus('Preparing...');
    const videoSrc = getSourceUrl(videoFileInput, videoUrlInput);
    const audioSrc = getSourceUrl(audioFileInput, audioUrlInput);
    if (!videoSrc) { setCombineStatus('Provide video source.'); return; }
    if (!audioSrc && !videoOnlyCheckbox.checked) { setCombineStatus('Provide audio source or enable video-only.'); return; }
  
    try { await prepareElements(videoSrc, audioSrc); } 
    catch (e) { setCombineStatus('Error loading media: ' + e.message); return; }
  
    const captureFn = videoEl.captureStream || videoEl.mozCaptureStream || videoEl.webkitCaptureStream;
    if (!captureFn) { setCombineStatus('captureStream not supported.'); return; }
  
    const videoStream = videoEl.captureStream();
    combinedStream = new MediaStream();
    videoStream.getVideoTracks().forEach(t => combinedStream.addTrack(t));
  
    if (!videoOnlyCheckbox.checked && audioSrc) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const srcNode = audioContext.createMediaElementSource(audioEl);
        audioDestination = audioContext.createMediaStreamDestination();
        srcNode.connect(audioDestination);
        audioDestination.stream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      } catch (e) {
        videoStream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
      }
    } else {
      videoStream.getAudioTracks().forEach(t => combinedStream.addTrack(t));
    }
  
    try { await videoEl.play().catch(()=>{}); } catch(e){}
    try { if (audioEl && audioSrc) await audioEl.play().catch(()=>{}); } catch(e){}
  
    recordedChunks = [];
    let options = { mimeType: 'video/webm;codecs=vp9,opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/webm;codecs=vp8,opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'video/webm' };
    }
  
    try {
      mediaRecorder = new MediaRecorder(combinedStream, options);
    } catch (err) {
      setCombineStatus('Could not create MediaRecorder: ' + err.message);
      return;
    }
  
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const filename = `combined_${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setCombineStatus(`Finished. Downloaded ${filename}.`);
      try { videoEl.pause(); videoEl.src=''; videoEl.remove(); } catch(e){} videoEl=null;
      try { audioEl.pause(); audioEl.src=''; audioEl.remove(); } catch(e){} audioEl=null;
      try { if (audioContext) audioContext.close(); } catch(e){} audioContext=null;
      combineStartBtn.disabled = false;
      combineStopBtn.disabled = true;
    };
  
    try {
      mediaRecorder.start(1000);
      setCombineStatus('Recording... click Stop when finished.');
      combineStartBtn.disabled = true;
      combineStopBtn.disabled = false;
    } catch (err) {
      setCombineStatus('Failed to start recording: ' + err.message);
    }
  }
  
  function stopCombine() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    combineStartBtn.disabled = false;
    combineStopBtn.disabled = true;
    setCombineStatus('Stopping...');
  }
  
  combineStartBtn.addEventListener('click', startCombine);
  combineStopBtn.addEventListener('click', stopCombine);
  