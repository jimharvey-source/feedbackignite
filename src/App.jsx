import { useState, useRef } from 'react'

const SHARPENING_MARKER = '__NEEDS_SHARPENING__'

// Icons
const FlameIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C12 2 7 7 7 13a5 5 0 0010 0C17 7 12 2 12 2z" fill="currentColor" opacity="0.9"/>
    <path d="M12 8c0 0-3 3-3 5a3 3 0 006 0C15 11 12 8 12 8z" fill="white" opacity="0.45"/>
  </svg>
)

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
  </svg>
)

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const AlertIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)

export default function App() {
  const [inputText, setInputText] = useState('')
  const [tone, setTone] = useState('Empathetic')
  const [output, setOutput] = useState('')
  const [cadence, setCadence] = useState('')
  const [sharpeningNote, setSharpeningNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const outputRef = useRef(null)

  const handleGenerate = async () => {
    if (!inputText.trim()) {
      setError('Please enter your feedback notes before generating.')
      return
    }

    setError('')
    setSharpeningNote('')
    setOutput('')
    setCadence('')
    setLoading(true)

    try {
      const res = await fetch('/api/generate-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputText: inputText.trim(), tone })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (res.status === 503) {
          setError('The service is busy right now. Please try again in a moment.')
        } else {
          setError(errData.error || 'Something went wrong. Please try again.')
        }
        return
      }

      const data = await res.json()
      const result = data.result || ''

      // Check if the AI returned a sharpening response
      if (result.startsWith(SHARPENING_MARKER)) {
        setSharpeningNote(result.replace(SHARPENING_MARKER, '').trim())
      } else {
        // Parse cadence block if present (delimited by ===CADENCE===)
        const cadenceMarker = '===CADENCE==='
        const cadenceIndex = result.indexOf(cadenceMarker)
        if (cadenceIndex !== -1) {
          setOutput(result.slice(0, cadenceIndex).trim())
          setCadence(result.slice(cadenceIndex + cadenceMarker.length).trim())
        } else {
          setOutput(result)
        }
        // Scroll to output
        setTimeout(() => {
          outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!output) return
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const hasOutput = !!output

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="page-header">
        <div className="header-inner">
          <a href="/" className="brand">
            <div className="brand-icon">
              <FlameIcon />
            </div>
            <span className="brand-name">Feedback <span>Ignite</span></span>
          </a>
          <span className="suite-badge">Management Ignition</span>
        </div>
      </header>

      {/* Main */}
      <main className="main-content">
        <div className="content-inner">

          {/* Hero */}
          <div className="hero">
            <h1>Turn raw notes into<br /><em>feedback that sticks</em></h1>
            <p>Clear, motivating development feedback — structured around 30 years of leadership research.</p>
          </div>

          {/* Input Card */}
          <div className="card">
            <div className="card-title">Your feedback notes</div>

            <label className="field-label" htmlFor="input-notes">What do you want to say?</label>
            <p className="field-hint">Describe what happened, in what context, and what you want this person to develop. The more specific you are, the more useful the output.</p>

            <textarea
              id="input-notes"
              value={inputText}
              onChange={e => { setInputText(e.target.value); setSharpeningNote(''); setError('') }}
              placeholder="e.g. Sarah presented the Q3 numbers to the leadership team last Thursday. She had clearly done the analysis but when challenged by the CEO on the assumptions, she became flustered and couldn't defend her methodology. She needs to be able to hold her ground under pressure and come with stronger narrative, not just numbers."
              rows={7}
            />

            {/* Sharpening Notice */}
            {sharpeningNote && (
              <div className="sharpening-notice">
                <div className="notice-heading">
                  <AlertIcon />
                  Your notes need more detail
                </div>
                <p>{sharpeningNote}</p>
              </div>
            )}

            <div className="divider" />

            {/* Tone selector */}
            <div className="card-title">Feedback style</div>
            <div className="tone-group">
              <button
                className={`tone-btn${tone === 'Empathetic' ? ' selected' : ''}`}
                onClick={() => setTone('Empathetic')}
                type="button"
              >
                <span className="tone-label">Empathetic</span>
                <span className="tone-desc">Warm and supportive — still direct and clear</span>
              </button>
              <button
                className={`tone-btn${tone === 'Direct' ? ' selected' : ''}`}
                onClick={() => setTone('Direct')}
                type="button"
              >
                <span className="tone-label">Direct</span>
                <span className="tone-desc">Concise and professional — respectful but unambiguous</span>
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="error-msg">
                <AlertIcon /> {error}
              </div>
            )}

            {/* Generate */}
            <button
              className="generate-btn"
              onClick={handleGenerate}
              disabled={loading}
              type="button"
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Generating...
                </>
              ) : (
                <>
                  <div style={{ width: 18, height: 18, color: 'white' }}><FlameIcon /></div>
                  Generate Feedback
                </>
              )}
            </button>
          </div>

          {/* Output */}
          {hasOutput && (
            <div className="output-section" ref={outputRef}>
              <div className="card">
                <div className="output-header">
                  <div className="card-title" style={{ marginBottom: 0 }}>Your feedback, reframed</div>
                  <button
                    className={`copy-btn${copied ? ' copied' : ''}`}
                    onClick={handleCopy}
                    type="button"
                  >
                    {copied ? <><CheckIcon /> Copied</> : <><CopyIcon /> Copy</>}
                  </button>
                </div>
                <textarea
                  className="output-area"
                  value={output}
                  onChange={e => setOutput(e.target.value)}
                  rows={14}
                />
              </div>

              {/* Cadence Card */}
              {cadence && (
                <div className="cadence-card">
                  <div className="card-title">Suggested feedback cadence</div>
                  <CadenceDisplay content={cadence} />
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* Footer */}
      <footer className="page-footer">
        <div className="footer-inner">
          <p>© 2024 Jim Harvey / <a href="https://themessagebusiness.com" target="_blank" rel="noopener noreferrer">The Message Business</a></p>
          <div className="suite-links">
            <a href="https://delegateignite.themessagebusiness.com" target="_blank" rel="noopener noreferrer">Delegate Ignite</a>
            <a href="https://management-ignition.com" target="_blank" rel="noopener noreferrer">Management Ignition</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// Cadence display parses structured cadence text into pills + prose
function CadenceDisplay({ content }) {
  // Look for pill markers like [Weekly] [Informal] [One-to-one]
  const pillRegex = /\[([^\]]+)\]/g
  const pills = []
  let match
  while ((match = pillRegex.exec(content)) !== null) {
    pills.push(match[1])
  }
  const prose = content.replace(pillRegex, '').trim()

  return (
    <div className="cadence-content">
      {prose && <p>{prose}</p>}
      {pills.length > 0 && (
        <div className="cadence-pills">
          {pills.map((p, i) => (
            <span key={i} className="cadence-pill">{p}</span>
          ))}
        </div>
      )}
    </div>
  )
}
