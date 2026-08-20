import { useState, useEffect, useRef } from 'react'
import {
  createSuiteClient,
  personIdFromUrl,
  loadPerson,
  saveToolSession,
} from './mi-session.js'

const supabase = createSuiteClient({
  url: 'https://fdiitxhgfytvlbtokbok.supabase.co',
  anonKey: 'sb_publishable_JQMFDaTz5g-2ZlitosUTeA_C9B48-Lc',
})

// Where to send a manager who wants to turn this into coaching.
const COACH_URL = 'https://coach.management-ignition.com'

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

const MailIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)

const ShareIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
)

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

const SLIDER_LABELS = ['Very low', 'Low', 'Medium', 'High', 'Very high']

function SliderInput({ label, hint, value, onChange }) {
  return (
    <div className="slider-field">
      <div className="slider-header">
        <span className="field-label">{label}</span>
        <span className="slider-value">{SLIDER_LABELS[value - 1]}</span>
      </div>
      <p className="field-hint">{hint}</p>
      <input
        type="range" min="1" max="5" value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="slider"
      />
      <div className="slider-ticks"><span>Very low</span><span>Very high</span></div>
    </div>
  )
}

export default function App() {
  const [inputText, setInputText] = useState('')
  const [tone, setTone] = useState('Empathetic')
  const [skill, setSkill] = useState(3)
  const [confidence, setConfidence] = useState(3)
  const [output, setOutput] = useState('')
  const [guide, setGuide] = useState('')
  const [cadence, setCadence] = useState('')
  const [activeTab, setActiveTab] = useState('feedback')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [guideCopied, setGuideCopied] = useState(false)
  const outputRef = useRef(null)

  // The suite. Feedback has never had sign-in of its own, and it still does
  // not need one: arriving from the app carries the session in a cookie. On
  // its own it works exactly as before, for anyone, with no account.
  const [user, setUser] = useState(null)
  const [person, setPerson] = useState(null)
  const [saveState, setSaveState] = useState('idle')
  const [savedId, setSavedId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user || null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) { setPerson(null); return }
    let cancelled = false
    loadPerson(supabase, personIdFromUrl()).then(p => {
      if (!cancelled && p) setPerson(p)
    })
    return () => { cancelled = true }
  }, [user])

  // What the record already knows. Good feedback leads from a real strength,
  // and this is where the real strength is written down.
  const personContext = person ? [
    person.first_name ? `Name: ${[person.first_name, person.last_name].filter(Boolean).join(' ')}` : '',
    person.role_title ? `Role: ${person.role_title}` : '',
    person.strengths ? `Where they are strong: ${person.strengths}` : '',
    person.development_focus ? `The next step up for them: ${person.development_focus}` : '',
    person.motivation ? `What they respond to: ${person.motivation}` : '',
  ].filter(Boolean).join('\n') : ''

  const handleGenerate = async () => {
    if (!inputText.trim()) {
      setError('Please enter your feedback notes before generating.')
      return
    }
    setError('')
    setOutput('')
    setGuide('')
    setCadence('')
    setActiveTab('feedback')
    setSaveState('idle')
    setSavedId(null)
    setLoading(true)

    try {
      const res = await fetch('/api/generate-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputText: inputText.trim(), tone, skill, confidence, personContext })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setError(res.status === 503
          ? 'The service is busy right now. Please try again in a moment.'
          : errData.error || 'Something went wrong. Please try again.')
        return
      }

      const data = await res.json()
      const result = data.result || ''
      const guideResult = data.guide || ''

      const cadenceMarker = '===CADENCE==='
      const cadenceIndex = result.indexOf(cadenceMarker)
      if (cadenceIndex !== -1) {
        setOutput(result.slice(0, cadenceIndex).trim())
        setCadence(result.slice(cadenceIndex + cadenceMarker.length).trim())
      } else {
        setOutput(result)
      }
      setGuide(guideResult)

      setTimeout(() => {
        outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

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

  const handleMail = () => {
    if (!output) return
    const subject = encodeURIComponent('Your development feedback')
    const body = encodeURIComponent(output)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const handleShare = async () => {
    if (!output) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Development feedback',
          text: output
        })
      } catch (err) {
        // User cancelled — do nothing
      }
    } else {
      // Fallback: copy and show message
      navigator.clipboard.writeText(output)
      alert('Copied to clipboard — paste into WhatsApp, Slack, or wherever you need it.')
    }
  }

  const handleGuideCopy = () => {
    if (!guide) return
    navigator.clipboard.writeText(guide).then(() => {
      setGuideCopied(true)
      setTimeout(() => setGuideCopied(false), 2000)
    })
  }

  const handleGuideShare = async () => {
    if (!guide) return
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Conversation guide',
          text: guide
        })
      } catch (err) {
        // User cancelled — do nothing
      }
    } else {
      navigator.clipboard.writeText(guide)
      alert('Copied to clipboard — paste into your notes or wherever you need it.')
    }
  }

  const handleSaveToPerson = async () => {
    if (!output || !person) return
    setSaveState('saving')
    const { data, error: saveError } = await saveToolSession(supabase, {
      tool: 'feedback',
      personId: person.id,
      title: `Feedback for ${person.first_name}`,
      inputs: { inputText, tone, skill, confidence },
      outputs: { output, guide, cadence },
    })
    if (saveError) {
      setSaveState('idle')
      setError('That could not be saved to the person record.')
      return
    }
    setSavedId(data?.id || null)
    setSaveState('saved')
  }

  // The chain. Save first, then hand Coach the session so it can open the
  // conversation from the development point rather than a blank box.
  const handleTakeToCoaching = async () => {
    if (!person) return
    let id = savedId
    if (!id) {
      await handleSaveToPerson()
      id = savedId
    }
    const u = new URL(COACH_URL)
    u.searchParams.set('mi_person', person.id)
    if (id) u.searchParams.set('mi_from', id)
    window.open(u.toString(), '_blank', 'noopener')
  }

  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const handleDownloadPdf = async () => {
    if (!output) return
    setDownloadingPdf(true)
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'feedback', inputText, tone, skill, confidence, output, guide, cadence })
      })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Feedback Ignite - Development feedback.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('The PDF could not be generated. Please try again.')
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="page-header">
        <div className="header-inner">
          <a href="/" className="brand">
            <div className="brand-icon"><FlameIcon /></div>
            <div className="brand-text">
              <span className="brand-name">Feedback <span>Ignite</span></span>
              <span className="brand-suite">Part of the Management Ignition Suite</span>
            </div>
          </a>
        </div>
      </header>

      <main className="main-content">
        <div className="content-inner">

          <div className="hero">
            <h1>Turn raw notes into<br /><em>feedback that sticks</em></h1>
            <p>Clear, motivating development feedback — structured around 30 years of leadership research.</p>
          </div>

          {person && (
            <div className="card" style={{ borderLeft: '3px solid #8B00CC' }}>
              <div className="card-title" style={{ marginBottom: 6 }}>
                Feedback for {[person.first_name, person.last_name].filter(Boolean).join(' ')}
              </div>
              <p className="field-hint" style={{ marginBottom: person.strengths || person.development_focus ? 10 : 0 }}>
                This will be written from what you already know about them, and saved to their record.
              </p>
              {person.strengths && (
                <p className="field-hint" style={{ margin: '0 0 6px' }}>
                  <strong>Where they are strong:</strong> {person.strengths}
                </p>
              )}
              {person.development_focus && (
                <p className="field-hint" style={{ margin: 0 }}>
                  <strong>The next step up:</strong> {person.development_focus}
                </p>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title">Your feedback notes</div>
            <label className="field-label" htmlFor="input-notes">What do you want to say?</label>
            <p className="field-hint">Describe what happened, in what context, and what you want this person to develop. The more specific you are, the more useful the output.</p>
            <textarea
              id="input-notes"
              value={inputText}
              onChange={e => { setInputText(e.target.value); setError('') }}
              placeholder="e.g. Sarah presented the Q3 numbers to the leadership team last Thursday. She had clearly done the analysis but when challenged by the CEO on the assumptions, she became flustered and couldn't defend her methodology. She needs to be able to hold her ground under pressure and come with stronger narrative, not just numbers."
              rows={7}
            />

            <div className="divider" />

            <div className="card-title">About this person</div>
            <SliderInput
              label="Skill level"
              hint="How capable are they at this type of task or responsibility?"
              value={skill}
              onChange={setSkill}
            />
            <SliderInput
              label="Confidence level"
              hint="How confident are they in their own ability right now?"
              value={confidence}
              onChange={setConfidence}
            />

            <div className="divider" />

            <div className="card-title">Feedback style</div>
            <div className="tone-group">
              <button className={`tone-btn${tone === 'Empathetic' ? ' selected' : ''}`} onClick={() => setTone('Empathetic')} type="button">
                <span className="tone-label">Empathetic</span>
                <span className="tone-desc">Warm and supportive — still direct and clear</span>
              </button>
              <button className={`tone-btn${tone === 'Direct' ? ' selected' : ''}`} onClick={() => setTone('Direct')} type="button">
                <span className="tone-label">Direct</span>
                <span className="tone-desc">Concise and professional — respectful but unambiguous</span>
              </button>
            </div>

            {error && <div className="error-msg"><AlertIcon /> {error}</div>}

            <button className="generate-btn" onClick={handleGenerate} disabled={loading} type="button">
              {loading
                ? <><span className="spinner" />Generating...</>
                : <><div style={{ width: 18, height: 18, color: 'white' }}><FlameIcon /></div>Generate Feedback</>
              }
            </button>
          </div>

          {output && (
            <div className="output-section" ref={outputRef}>
              <div className="card">
                <div className="tab-bar">
                  <button className={`tab-btn${activeTab === 'feedback' ? ' active' : ''}`} onClick={() => setActiveTab('feedback')} type="button">Feedback</button>
                  {guide && <button className={`tab-btn${activeTab === 'guide' ? ' active' : ''}`} onClick={() => setActiveTab('guide')} type="button">Conversation guide</button>}
                </div>

                {activeTab === 'feedback' && (
                  <div className="tab-content">
                    <div className="output-header">
                      <div className="card-title" style={{ marginBottom: 0 }}>Your feedback, reframed</div>
                      <div className="action-btns">
                        <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy} type="button">
                          {copied ? <><CheckIcon /> Copied</> : <><CopyIcon /> Copy</>}
                        </button>
                        <button className="copy-btn" onClick={handleMail} type="button">
                          <MailIcon /> Email
                        </button>
                        <button className="copy-btn" onClick={handleShare} type="button">
                          <ShareIcon /> Share
                        </button>
                        <button className="copy-btn" onClick={handleDownloadPdf} disabled={downloadingPdf} type="button">
                          <DownloadIcon /> {downloadingPdf ? 'Preparing…' : 'PDF'}
                        </button>
                        {person && (
                          <button
                            className={`copy-btn${saveState === 'saved' ? ' copied' : ''}`}
                            onClick={handleSaveToPerson}
                            disabled={saveState !== 'idle'}
                            type="button"
                          >
                            {saveState === 'saved'
                              ? <><CheckIcon /> Saved to {person.first_name}</>
                              : saveState === 'saving' ? 'Saving…' : `Save to ${person.first_name}'s record`}
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea className="output-area" value={output} onChange={e => setOutput(e.target.value)} rows={14} />

                    {person && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                        <p className="field-hint" style={{ margin: '0 0 8px' }}>
                          The development point in this feedback is the thing worth coaching. Take it
                          straight into a conversation with {person.first_name}, with the context carried across.
                        </p>
                        <button className="copy-btn" onClick={handleTakeToCoaching} type="button">
                          Take this into a coaching conversation
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'guide' && guide && (
                  <div className="tab-content">
                    <div className="output-header">
                      <div className="card-title" style={{ marginBottom: 0 }}>How to have this conversation</div>
                      <div className="action-btns">
                        <button className={`copy-btn${guideCopied ? ' copied' : ''}`} onClick={handleGuideCopy} type="button">
                          {guideCopied ? <><CheckIcon /> Copied</> : <><CopyIcon /> Copy</>}
                        </button>
                        <button className="copy-btn" onClick={handleGuideShare} type="button">
                          <ShareIcon /> Share
                        </button>
                      </div>
                    </div>
                    <GuideDisplay content={guide} />
                  </div>
                )}
              </div>

              {cadence && activeTab === 'feedback' && (
                <div className="cadence-card">
                  <div className="card-title">Suggested feedback cadence</div>
                  <CadenceDisplay content={cadence} />
                </div>
              )}
            </div>
          )}

        </div>
      </main>

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

function GuideDisplay({ content }) {
  // The known section headings from the prompt.
  const KNOWN_HEADINGS = [
    'Before the conversation',
    'Tone and approach',
    'How much direction to give',
    'What to listen for',
    'Suggested opening'
  ]
  const isHeading = (s) =>
    KNOWN_HEADINGS.some(h => s.trim().toLowerCase() === h.toLowerCase())

  // Split on the section marker. The model emits the marker between every block,
  // so headings and their bodies arrive as alternating blocks. Pair each known
  // heading with the block that follows it.
  const blocks = content.split('===SECTION===').map(s => s.trim()).filter(Boolean)
  const sections = []
  for (let i = 0; i < blocks.length; i++) {
    if (isHeading(blocks[i])) {
      const heading = KNOWN_HEADINGS.find(h => h.toLowerCase() === blocks[i].toLowerCase())
      const next = blocks[i + 1]
      if (next && !isHeading(next)) {
        sections.push({ heading, body: next })
        i++ // consume the body block
      } else {
        sections.push({ heading, body: '' })
      }
    } else {
      // A stray body block with no preceding heading — render as plain prose.
      sections.push({ heading: '', body: blocks[i] })
    }
  }

  return (
    <div className="guide-content">
      {sections.map((section, i) => (
        <div key={i} className="guide-section">
          {section.heading && <div className="guide-heading">{section.heading}</div>}
          {section.body && <p>{section.body}</p>}
        </div>
      ))}
    </div>
  )
}

function CadenceDisplay({ content }) {
  const pillRegex = /\[([^\]]+)\]/g
  const pills = []
  let match
  while ((match = pillRegex.exec(content)) !== null) pills.push(match[1])
  const prose = content.replace(pillRegex, '').trim()
  return (
    <div className="cadence-content">
      {prose && <p>{prose}</p>}
      {pills.length > 0 && (
        <div className="cadence-pills">
          {pills.map((p, i) => <span key={i} className="cadence-pill">{p}</span>)}
        </div>
      )}
    </div>
  )
}
