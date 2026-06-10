/**
 * ReplyMate — script.js
 * ──────────────────────────────────────────────────────────────
 * SECURITY NOTE (IMPORTANT — READ BEFORE DEPLOYING):
 *
 * This file handles AI API calls in the browser. For a personal /
 * demo tool this is acceptable. For production:
 *
 * 1. Move generateReply() and fixGrammarWithAI() to a server-side
 *    endpoint (Node.js, Python Flask, Cloudflare Workers, etc.)
 * 2. Store the API key in an environment variable on the server.
 * 3. The frontend should call YOUR backend endpoint, not OpenAI
 *    directly — so the key is never visible in browser DevTools.
 *
 * BACKEND MIGRATION GUIDE (when ready):
 *   - Create POST /api/reply   → calls OpenAI, returns text
 *   - Create POST /api/grammar → calls OpenAI, returns text
 *   - Remove apiKey from browser storage entirely
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let state = {
  apiKey:        sessionStorage.getItem('rm_api_key') || '',
  apiEndpoint:   sessionStorage.getItem('rm_endpoint') || 'https://api.openai.com/v1/chat/completions',
  selectedTone:  'formal',
  lastExtracted: '',
};

/* ═══════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════ */
const $ = id => document.getElementById(id);

const dom = {
  // Theme
  themeToggle:      $('themeToggle'),
  // OCR
  dropZone:         $('dropZone'),
  imageUpload:      $('imageUpload'),
  previewWrap:      $('previewWrap'),
  previewImg:       $('previewImg'),
  clearImageBtn:    $('clearImageBtn'),
  ocrError:         $('ocrError'),
  ocrProgress:      $('ocrProgress'),
  ocrProgressText:  $('ocrProgressText'),
  extractedTextGroup: $('extractedTextGroup'),
  extractedText:    $('extractedText'),
  extractedCharCount: $('extractedCharCount'),
  copyExtractedBtn: $('copyExtractedBtn'),
  clearExtractedBtn:$('clearExtractedBtn'),
  useForReplyBtn:   $('useForReplyBtn'),
  retryOcrBtn:      $('retryOcrBtn'),
  // Reply
  inputText:        $('inputText'),
  inputCharCount:   $('inputCharCount'),
  pasteBtn:         $('pasteBtn'),
  clearInputBtn:    $('clearInputBtn'),
  toneBtns:         document.querySelectorAll('.tone-btn'),
  apiKeyInput:      $('apiKeyInput'),
  apiEndpointInput: $('apiEndpointInput'),
  saveApiKeyBtn:    $('saveApiKeyBtn'),
  replyError:       $('replyError'),
  generateReplyBtn: $('generateReplyBtn'),
  repliesOutput:    $('repliesOutput'),
  replyCards:       $('replyCards'),
  // Grammar
  grammarInput:     $('grammarInput'),
  grammarOutput:    $('grammarOutput'),
  grammarCharCount: $('grammarCharCount'),
  clearGrammarBtn:  $('clearGrammarBtn'),
  copyGrammarBtn:   $('copyGrammarBtn'),
  fixGrammarBtn:    $('fixGrammarBtn'),
  grammarError:     $('grammarError'),
  grammarSource:    $('grammarSource'),
  // Toast
  toastContainer:   $('toastContainer'),
};

/* ═══════════════════════════════════════
   THEME TOGGLE
═══════════════════════════════════════ */
const savedTheme = localStorage.getItem('rm_theme') || 'dark';
document.body.setAttribute('data-theme', savedTheme);

dom.themeToggle.addEventListener('click', () => {
  const current = document.body.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('rm_theme', next);
});

/* ═══════════════════════════════════════
   SCROLL REVEAL (IntersectionObserver)
   Animates cards as they enter viewport
═══════════════════════════════════════ */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.card').forEach(card => revealObserver.observe(card));

/* ═══════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════ */
function showToast(message, type = 'info', duration = 2800) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = `toast-out 300ms ease forwards`;
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* ═══════════════════════════════════════
   SHOW / HIDE ERROR HELPER
═══════════════════════════════════════ */
function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
  el.textContent = '';
}

/* ═══════════════════════════════════════
   CHARACTER COUNTERS
═══════════════════════════════════════ */
function updateCharCount(textarea, countEl) {
  const len = textarea.value.length;
  countEl.textContent = `${len.toLocaleString()} char${len !== 1 ? 's' : ''}`;
}

dom.extractedText.addEventListener('input', () =>
  updateCharCount(dom.extractedText, dom.extractedCharCount));

dom.inputText.addEventListener('input', () =>
  updateCharCount(dom.inputText, dom.inputCharCount));

dom.grammarInput.addEventListener('input', () =>
  updateCharCount(dom.grammarInput, dom.grammarCharCount));

/* ═══════════════════════════════════════
   ──────────────────────────────────────
   SECTION 1: OCR — IMAGE TO TEXT
   Uses Tesseract.js (all client-side,
   no server or API key required)
   ──────────────────────────────────────
═══════════════════════════════════════ */

/* ── Drag & drop events ── */
dom.dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dom.dropZone.classList.add('drag-over');
});

dom.dropZone.addEventListener('dragleave', () => {
  dom.dropZone.classList.remove('drag-over');
});

dom.dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dom.dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleImageFile(file);
});

/* ── Click to open file picker ── */
dom.dropZone.addEventListener('click', () => dom.imageUpload.click());
dom.dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') dom.imageUpload.click();
});

dom.imageUpload.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleImageFile(file);
});

/* ── Validate & start OCR ── */
function handleImageFile(file) {
  hideError(dom.ocrError);

  // Validate file type
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    showError(dom.ocrError, '❌ Unsupported file type. Please upload a JPG, PNG, or WEBP image.');
    return;
  }

  // Validate file size (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    showError(dom.ocrError, '❌ File too large. Maximum size is 10MB.');
    return;
  }

  // Show preview
  const url = URL.createObjectURL(file);
  dom.previewImg.src = url;
  dom.previewWrap.hidden = false;
  dom.dropZone.hidden = true;
  dom.extractedTextGroup.hidden = true;
  dom.retryOcrBtn.hidden = true;

  runOCR(file);
}

/* ── Run Tesseract OCR ── */
async function runOCR(file) {
  dom.ocrProgress.hidden = false;
  dom.ocrProgressText.textContent = 'Starting OCR engine…';

  try {
    // Tesseract v5 worker API
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          dom.ocrProgressText.textContent = `Reading image… ${pct}%`;
        }
      }
    });

    const result = await worker.recognize(file);
    await worker.terminate();

    const text = result.data.text.trim();

    if (!text) {
      throw new Error('No readable text found. Try a clearer, higher-resolution screenshot.');
    }

    // Show results
    dom.extractedText.value = text;
    updateCharCount(dom.extractedText, dom.extractedCharCount);
    dom.extractedTextGroup.hidden = false;
    dom.retryOcrBtn.hidden = false;
    state.lastExtracted = text;

    showToast('✓ Text extracted successfully!', 'success');

  } catch (err) {
    // OCR error handling
    const msg = err.message.includes('No readable text')
      ? `⚠️ ${err.message}`
      : '❌ Image unreadable. Try a clearer, well-lit screenshot with readable text.';

    showError(dom.ocrError, msg);
    dom.retryOcrBtn.hidden = false;

  } finally {
    dom.ocrProgress.hidden = true;
  }
}

/* ── Clear image / retry ── */
function resetOCR() {
  dom.imageUpload.value = '';
  dom.previewImg.src = '';
  dom.previewWrap.hidden = true;
  dom.dropZone.hidden = false;
  dom.ocrProgress.hidden = true;
  dom.extractedTextGroup.hidden = true;
  dom.retryOcrBtn.hidden = true;
  dom.extractedText.value = '';
  hideError(dom.ocrError);
}

dom.clearImageBtn.addEventListener('click', resetOCR);
dom.retryOcrBtn.addEventListener('click', resetOCR);

/* ── Copy / clear extracted text ── */
dom.copyExtractedBtn.addEventListener('click', () => {
  copyToClipboard(dom.extractedText.value, 'Extracted text copied!');
});

dom.clearExtractedBtn.addEventListener('click', () => {
  dom.extractedText.value = '';
  updateCharCount(dom.extractedText, dom.extractedCharCount);
});

/* ── Use extracted text as reply input ── */
dom.useForReplyBtn.addEventListener('click', () => {
  dom.inputText.value = dom.extractedText.value;
  updateCharCount(dom.inputText, dom.inputCharCount);
  document.getElementById('reply-section').scrollIntoView({ behavior: 'smooth' });
  dom.inputText.focus();
  showToast('Text copied to reply input ↓', 'success');
});

/* ═══════════════════════════════════════
   ──────────────────────────────────────
   SECTION 2: AI REPLY GENERATOR
   ──────────────────────────────────────
═══════════════════════════════════════ */

/* ── API key management ── */
dom.apiKeyInput.value = state.apiKey;
dom.apiEndpointInput.value = state.apiEndpoint;

dom.saveApiKeyBtn.addEventListener('click', () => {
  state.apiKey = dom.apiKeyInput.value.trim();
  state.apiEndpoint = dom.apiEndpointInput.value.trim() || 'https://api.openai.com/v1/chat/completions';

  // Store in sessionStorage only (cleared when tab closes)
  // WARNING: sessionStorage is still visible to JavaScript on the page.
  // For production, move API calls to your own backend server.
  sessionStorage.setItem('rm_api_key', state.apiKey);
  sessionStorage.setItem('rm_endpoint', state.apiEndpoint);

  showToast('API key saved for this session', 'success');
});

/* ── Tone selection ── */
dom.toneBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    dom.toneBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    state.selectedTone = btn.dataset.tone;
  });
});

/* ── Manual text controls ── */
dom.pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    dom.inputText.value = text;
    updateCharCount(dom.inputText, dom.inputCharCount);
    showToast('Text pasted from clipboard', 'success');
  } catch {
    showToast('Could not read clipboard. Try Ctrl+V / Cmd+V.', 'error');
  }
});

dom.clearInputBtn.addEventListener('click', () => {
  dom.inputText.value = '';
  updateCharCount(dom.inputText, dom.inputCharCount);
});

/* ── Generate reply button ── */
dom.generateReplyBtn.addEventListener('click', async () => {
  const text = dom.inputText.value.trim();

  if (!text) {
    showError(dom.replyError, '⚠️ Please enter or paste a message to reply to.');
    dom.inputText.focus();
    return;
  }

  hideError(dom.replyError);
  setButtonLoading(dom.generateReplyBtn, true);
  dom.repliesOutput.hidden = true;

  try {
    const replies = await generateReply(text, state.selectedTone);
    displayReplies(replies);
  } catch (err) {
    showError(dom.replyError, `❌ ${err.message}`);
  } finally {
    setButtonLoading(dom.generateReplyBtn, false);
  }
});

/**
 * generateReply()
 * ──────────────────────────────────────
 * Calls the AI API to generate reply suggestions.
 *
 * TO MOVE THIS TO BACKEND:
 *   1. Create a server endpoint, e.g. POST /api/reply
 *   2. Replace the fetch() below with:
 *      fetch('/api/reply', { method:'POST', body: JSON.stringify({text, tone}) })
 *   3. Handle the OpenAI call on the server with your stored API key.
 *   4. Delete apiKey from the browser entirely.
 * ──────────────────────────────────────
 */
async function generateReply(text, tone) {
  const toneInstructions = {
    formal:   'Write a professional, polished, respectful reply. Use proper grammar and formal language.',
    friendly: 'Write a warm, casual, cheerful reply. Use conversational language and a friendly tone.',
    rizz:     'Write a smooth, confident, magnetically charming reply dripping with rizz. Think effortlessly cool — never try-hard, never cringe. Short punchy lines, subtle wit, a hint of mystery. Make them smile and want to reply instantly. Think main character energy.',
  };

  const systemPrompt = `You are a helpful messaging assistant. Generate 3 distinct reply suggestions for the given message. 
Tone: ${toneInstructions[tone]}
Format your response EXACTLY as:
REPLY_1: [your first reply here]
REPLY_2: [your second reply here]  
REPLY_3: [your third reply here]
Each reply should be a complete, natural message. No extra commentary.`;

  // If API key is available, use AI
  if (state.apiKey) {
    try {
      const response = await fetch(state.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${state.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',          // change to gpt-4o or your preferred model
          max_tokens: 500,
          temperature: 0.85,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: `Message to reply to: "${text}"` }
          ]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API error ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return parseAIReplies(content, tone);

    } catch (err) {
      // Network failure or API error → fall back to templates
      console.warn('[ReplyMate] AI API failed, using fallback templates:', err.message);
      showToast('AI unavailable — showing template replies', 'error');
      return getFallbackReplies(text, tone);
    }
  }

  // No API key → use fallback templates immediately
  return getFallbackReplies(text, tone);
}

/* ── Parse AI response into array of 3 replies ── */
function parseAIReplies(content, tone) {
  const lines = content.split('\n').filter(l => l.trim());
  const replies = [];

  lines.forEach(line => {
    const match = line.match(/^REPLY_\d+:\s*(.+)/i);
    if (match) replies.push(match[1].trim());
  });

  // If parsing failed, split into paragraphs
  if (replies.length < 1) {
    const parts = content.split(/\n\n+/).filter(p => p.trim());
    parts.slice(0, 3).forEach(p => replies.push(p.trim()));
  }

  return replies.length > 0 ? replies.slice(0, 3) : getFallbackReplies('', tone);
}

/* ── Fallback templates (no API needed) ── */
function getFallbackReplies(text, tone) {
  const lowerText = text.toLowerCase();
  const isQuestion = text.includes('?');
  const mentionsFree = lowerText.includes('free') || lowerText.includes('tonight') || lowerText.includes('meet');
  const mentionsThanks = lowerText.includes('thank');
  const mentionsHelp = lowerText.includes('help') || lowerText.includes('assist');

  const templates = {
    formal: [
      mentionsThanks
        ? "Thank you for your kind words. It was a pleasure to assist you."
        : isQuestion
          ? "Thank you for reaching out. I would be happy to address your inquiry. Could you provide a bit more context so I can give you the most accurate response?"
          : "Thank you for your message. I've reviewed the information and will get back to you with a comprehensive response shortly.",
      "I appreciate you taking the time to write. Please allow me some time to look into this matter and I will respond with a thorough update.",
      "Noted. I'll ensure this is handled with the appropriate attention. You can expect a full response within the day."
    ],
    friendly: [
      mentionsFree
        ? "Hey! Yes, I'm actually free — sounds like a great plan! 😊"
        : mentionsThanks
          ? "Aw, that's so sweet of you! Happy to help anytime! 😄"
          : "Hey! Thanks for the message — absolutely, let's make it happen! Just let me know the details.",
      "Oh nice, that works perfectly for me! Can't wait 😊",
      "Haha yes! I was literally just thinking about you. Count me in!"
    ],
    rizz: (() => {
      // Context-aware rizz lines — smooth, confident, never desperate
      if (mentionsFree)    return [
        "Depends. You buying? 😏",
        "My schedule just cleared up. Funny how that works.",
        "For you? I'll rearrange the whole day. Don't make it weird though 🔥"
      ];
      if (mentionsThanks)  return [
        "Don't thank me yet. I'm just getting started.",
        "See, I told you I'd come through. You doubted me.",
        "You can thank me properly later 😌"
      ];
      if (isQuestion)      return [
        "Bold question. I respect it. The answer is yes.",
        "Asking me that was a power move. I see you.",
        "Depends — are you ready for an honest answer? 👀"
      ];
      // Generic rizz fallbacks
      return [
        "You really know how to get my attention. Noted. 🔥",
        "I was going to play it cool but honestly? Yeah.",
        "Careful. I don't lose interest easily but I make it look effortless when I do 😏"
      ];
    })(),
  };

  return templates[tone] || templates.rizz || templates.formal;
}

/* ── Display reply cards ── */
function displayReplies(replies) {
  dom.replyCards.innerHTML = '';

  const labels = ['Option A', 'Option B', 'Option C'];

  replies.forEach((reply, i) => {
    const card = document.createElement('div');
    card.className = 'reply-card';

    card.innerHTML = `
      <div class="reply-card-label">${labels[i] || `Reply ${i + 1}`}</div>
      <p class="reply-card-text">${escapeHtml(reply)}</p>
      <button class="reply-card-copy" data-text="${escapeAttr(reply)}" aria-label="Copy this reply">
        📋 Copy
      </button>
    `;

    dom.replyCards.appendChild(card);
  });

  // Copy buttons on each reply card
  dom.replyCards.querySelectorAll('.reply-card-copy').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(btn.dataset.text, 'Reply copied!');
    });
  });

  dom.repliesOutput.hidden = false;
}

/* ═══════════════════════════════════════
   ──────────────────────────────────────
   SECTION 3: GRAMMAR FIXER
   Hybrid: JS rules first, AI if available
   ──────────────────────────────────────
═══════════════════════════════════════ */

dom.clearGrammarBtn.addEventListener('click', () => {
  dom.grammarInput.value = '';
  dom.grammarOutput.value = '';
  updateCharCount(dom.grammarInput, dom.grammarCharCount);
  dom.grammarSource.textContent = '';
  hideError(dom.grammarError);
});

dom.copyGrammarBtn.addEventListener('click', () => {
  copyToClipboard(dom.grammarOutput.value, 'Fixed text copied!');
});

dom.fixGrammarBtn.addEventListener('click', async () => {
  const text = dom.grammarInput.value.trim();

  if (!text) {
    showError(dom.grammarError, '⚠️ Please enter some text to fix.');
    dom.grammarInput.focus();
    return;
  }

  hideError(dom.grammarError);
  setButtonLoading(dom.fixGrammarBtn, true);
  dom.grammarSource.textContent = '';

  try {
    // Step 1: Always apply JS rules first (instant, offline)
    const jsFixed = applyBasicGrammarRules(text);

    // Step 2: Try to enhance with AI if API key is available
    if (state.apiKey) {
      try {
        const aiFixed = await fixGrammarWithAI(jsFixed);
        dom.grammarOutput.value = aiFixed;
        dom.grammarSource.textContent = '✦ Enhanced with AI';
        showToast('Grammar fixed with AI!', 'success');
        return;
      } catch (aiErr) {
        // AI failed — fall back to JS fix silently
        console.warn('[ReplyMate] Grammar AI failed:', aiErr.message);
        dom.grammarSource.textContent = '⚡ AI unavailable — basic fix applied';
        showToast('AI unavailable — basic fix used', 'error');
      }
    }

    dom.grammarOutput.value = jsFixed;
    dom.grammarSource.textContent = '⚡ Basic rules applied';
    showToast('Basic grammar fix applied', 'success');

  } catch (err) {
    showError(dom.grammarError, `❌ Something went wrong: ${err.message}`);
  } finally {
    setButtonLoading(dom.fixGrammarBtn, false);
  }
});

/**
 * applyBasicGrammarRules()
 * Rule-based JS grammar corrections.
 * Always runs — no API key needed.
 */
function applyBasicGrammarRules(text) {
  let t = text;

  // 1. Capitalize the first letter of each sentence
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());

  // 2. Capitalize standalone "i"
  t = t.replace(/\bi\b/g, 'I');

  // 3. Fix common contractions (u → you, ur → your, r → are, etc.)
  const slang = {
    '\\bu\\b': 'you', '\\bur\\b': 'your', '\\bu r\\b': 'you are',
    '\\bcant\\b': "can't", '\\bdont\\b': "don't", '\\bwont\\b': "won't",
    '\\bisnt\\b': "isn't", '\\barent\\b': "aren't", '\\bwasnt\\b': "wasn't",
    '\\bwerent\\b': "weren't", '\\bwouldnt\\b': "wouldn't", '\\bcouldnt\\b': "couldn't",
    '\\bshouldnt\\b': "shouldn't", '\\bhes\\b': "he's", '\\bshes\\b': "she's",
    '\\bthey re\\b': "they're", '\\btheyve\\b': "they've", '\\bweve\\b': "we've",
    '\\bIve\\b': "I've", '\\bId\\b': "I'd", '\\bIll\\b': "I'll",
    '\\bim\\b': "I'm", '\\bIm\\b': "I'm",
    '\\bcuz\\b': 'because', '\\bcoz\\b': 'because',
    '\\bgonna\\b': 'going to', '\\bwanna\\b': 'want to', '\\bgotta\\b': 'got to',
    '\\bkinda\\b': 'kind of', '\\bsorta\\b': 'sort of',
    '\\bbtw\\b': 'by the way', '\\bfyi\\b': 'for your information',
    '\\blmk\\b': 'let me know', '\\basap\\b': 'as soon as possible',
    '\\bngl\\b': 'not gonna lie', '\\btbh\\b': 'to be honest',
    '\\bidk\\b': "I don't know", '\\bimo\\b': 'in my opinion',
    '\\bnvm\\b': 'never mind', '\\bomg\\b': 'oh my god',
    '\\bsmh\\b': 'shaking my head', '\\bfr\\b': 'for real',
    '\\bty\\b': 'thank you', '\\bthx\\b': 'thanks',
  };

  Object.entries(slang).forEach(([pattern, replacement]) => {
    t = t.replace(new RegExp(pattern, 'gi'), replacement);
  });

  // 4. Remove double spaces
  t = t.replace(/  +/g, ' ');

  // 5. Ensure space after punctuation
  t = t.replace(/([.!?,;:])([A-Za-z])/g, '$1 $2');

  // 6. Ensure sentence-ending punctuation
  t = t.trim();
  if (t.length > 0 && !/[.!?]$/.test(t)) t += '.';

  // 7. Fix "a" vs "an" for common vowel words
  t = t.replace(/\ba ([aeiouAEIOU])/g, 'an $1');

  return t.trim();
}

/**
 * fixGrammarWithAI()
 * ──────────────────────────────────────
 * Sends text to AI for enhanced grammar fix.
 *
 * TO MOVE TO BACKEND:
 *   Replace the fetch() below with a call to
 *   your own proxy endpoint: POST /api/grammar
 *   Pass { text } in the body.
 * ──────────────────────────────────────
 */
async function fixGrammarWithAI(text) {
  const response = await fetch(state.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${state.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `You are a grammar correction assistant. Fix grammar, spelling, punctuation, and clarity of the given text. 
Return ONLY the corrected text. No explanations, no labels, no quotes. Just the fixed text.`
        },
        { role: 'user', content: text }
      ]
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || text;
}

/* ═══════════════════════════════════════
   UTILITY FUNCTIONS
═══════════════════════════════════════ */

/** Copy text to clipboard and show toast */
async function copyToClipboard(text, successMsg = 'Copied!') {
  if (!text) { showToast('Nothing to copy', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, 'success');
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(successMsg, 'success');
  }
}

/** Toggle button loading state */
function setButtonLoading(btn, isLoading) {
  const label   = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.btn-spinner');

  btn.disabled = isLoading;
  if (spinner) spinner.hidden = !isLoading;
  if (label)   label.style.opacity = isLoading ? '0.5' : '1';
}

/** Escape HTML for safe insertion */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Escape for data-attribute */
function escapeAttr(text) {
  return text.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/* ═══════════════════════════════════════
   NETWORK STATUS DETECTION
   Shows a warning if user goes offline
═══════════════════════════════════════ */
window.addEventListener('offline', () => {
  showToast('⚠️ You\'re offline — AI features won\'t work, OCR still works', 'error', 5000);
});

window.addEventListener('online', () => {
  showToast('Back online!', 'success');
});

/* ═══════════════════════════════════════
   INITIAL SETUP ON PAGE LOAD
═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Restore API endpoint in input
  if (dom.apiEndpointInput && state.apiEndpoint) {
    dom.apiEndpointInput.value = state.apiEndpoint;
  }

  // Auto-detect if key was saved
  if (state.apiKey) {
    dom.apiKeyInput.value = state.apiKey;
  }

  // Prevent form submission on Enter in single-line inputs
  [dom.apiKeyInput, dom.apiEndpointInput].forEach(input => {
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); dom.saveApiKeyBtn.click(); }
      });
    }
  });
});

/* ═══════════════════════════════════════
   COMMON ERRORS & FIXES (see README)
   ──────────────────────────────────────
   "Tesseract is not defined"
     → CDN failed to load. Reload, or host
       tesseract.min.js locally.

   "API error 401"
     → Invalid or expired API key.
       Update it in the ⚙️ panel.

   "API error 429"
     → Rate limit exceeded on your OpenAI
       account. Wait or upgrade plan.

   "Could not read clipboard"
     → Browser clipboard permission denied.
       Use Ctrl+V / Cmd+V to paste manually.

   OCR returns garbled text
     → The image resolution is too low.
       Use a high-res screenshot and ensure
       text is clearly readable.
═══════════════════════════════════════ */
