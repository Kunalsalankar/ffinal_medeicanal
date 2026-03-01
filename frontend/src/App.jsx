import React, { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { runPipeline } from './api.js'
import VentilatorDashboard from './pages/VentilatorDashboard/Dashboard.jsx'

function tryPrettyJson(text) {
  if (typeof text !== 'string') return null
  const s = text.trim()
  if (!s) return null
  if (!(s.startsWith('{') || s.startsWith('['))) return null
  try {
    const obj = JSON.parse(s)
    return JSON.stringify(obj, null, 2)
  } catch {
    return null
  }
}

function formatAny(value) {
  if (value == null) return ''
  if (typeof value === 'string') return tryPrettyJson(value) ?? value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function AgentCard({ agentKey, title, data, onOpenFullscreen }) {
  const [open, setOpen] = useState(true)
  const prompt = data?.prompt
  const output = data?.output
  const fromCache = Boolean(data?.from_cache)
  const type = data?.type

  const promptFormatted = formatAny(prompt)
  const outputFormatted = formatAny(output)

  const outputIsMarkdown = type === 'markdown'

  return (
    <section className={`card agentCard agentCard--${agentKey}`}>
      <header className="cardHeader">
        <div className="cardHeaderLeft">
          <div className="cardTitleRow">
            <h2 className="cardTitle">{title}</h2>
            {fromCache ? <span className="badge">Cache</span> : null}
          </div>
          <div className="cardSub">Prompt and output</div>
        </div>
        <button className="btn btnGhost" onClick={() => setOpen(v => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </header>

      {open ? (
        <div className="cardBody">
          <div className="grid">
            <div className="panel">
              <div className="panelTitleRow">
                <div className="panelTitle">Prompt</div>
                <button
                  className="panelAction"
                  type="button"
                  onClick={() =>
                    onOpenFullscreen({
                      title: `${title} — Prompt`,
                      kind: 'prompt',
                      content: promptFormatted || '—',
                      isMarkdown: false,
                      agentKey
                    })
                  }
                >
                  Full screen
                </button>
              </div>
              <pre className="code">{promptFormatted || '—'}</pre>
            </div>
            <div className="panel">
              <div className="panelTitleRow">
                <div className="panelTitle">Output</div>
                <button
                  className="panelAction"
                  type="button"
                  onClick={() =>
                    onOpenFullscreen({
                      title: `${title} — Output`,
                      kind: 'output',
                      content: outputFormatted || '—',
                      isMarkdown: outputIsMarkdown,
                      agentKey
                    })
                  }
                >
                  Full screen
                </button>
              </div>
              {outputIsMarkdown ? (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {output || ''}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="code">{outputFormatted || '—'}</pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function App() {
  const [page, setPage] = useState('pipeline')
  const [pptMode, setPptMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(null)
  const [userRequest, setUserRequest] = useState('A portable Class-3 Pediatric Ventilator')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const a4SimulationData = useMemo(
    () => ({
      simulation_results: {
        target_pressure: 30,
        peak_pressure: 32,
        overshoot_percent: 6,
        settling_time_sec: 1.4,
        steady_state_error_percent: 2,
        tidal_volume_error_percent: 4,
        max_flow_rate_L_min: 95
      }
    }),
    []
  )

  const a4IsoLimits = useMemo(
    () => ({
      max_pressure_cmH2O: 40,
      max_overshoot_percent: 10,
      max_settling_time_sec: 2,
      max_steady_state_error_percent: 5,
      max_tidal_volume_error_percent: 10,
      max_flow_rate_L_min: 120
    }),
    []
  )

  function downloadPdf() {
    const prevTitle = document.title
    const suffix = page === 'dashboard' ? 'Ventilator Dashboard' : 'Multi-Agent Pipeline'
    document.title = suffix
    window.setTimeout(() => {
      window.print()
      document.title = prevTitle
    }, 50)
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setFullscreen(null)
    }
    if (fullscreen) {
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }
  }, [fullscreen])

  const agents = useMemo(() => {
    const a = result?.agents || {}
    return [
      { key: 'A1', title: 'Agent A1 — Regulatory Specialist (Requirements)', data: a.A1 },
      { key: 'A2', title: 'Agent A2 — System Architect (System JSON)', data: a.A2 },
      { key: 'A3', title: 'Agent A3 — MATLAB Coder (Build Script)', data: a.A3 },
      { key: 'A4', title: 'Agent A4 — Validation & Verification (Report)', data: a.A4 }
    ]
  }, [result])

  async function onRun(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setResult(null)
    try {
      const r = await runPipeline(userRequest.trim(), {
        simulation_data: a4SimulationData,
        iso_limits: a4IsoLimits
      })
      setResult(r)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brandMark">TA</div>
          <div>
            <div className="brandTitle">Multi‑Agent Pipeline</div>
            <div className="brandSub">React UI for Gemini agents (prompts + outputs)</div>
          </div>

          <div className="nav">
            <button
              className={page === 'pipeline' ? 'navBtn navBtnActive' : 'navBtn'}
              onClick={() => setPage('pipeline')}
              type="button"
            >
              Pipeline
            </button>
            <button
              className={page === 'dashboard' ? 'navBtn navBtnActive' : 'navBtn'}
              onClick={() => setPage('dashboard')}
              type="button"
            >
              Ventilator Dashboard
            </button>

            {page === 'pipeline' ? (
              <>
                <button
                  className={pptMode ? 'navBtn navBtnActive' : 'navBtn'}
                  onClick={() => setPptMode(v => !v)}
                  type="button"
                >
                  PPT Mode
                </button>
                <button className="navBtn vdNoPrint" onClick={downloadPdf} type="button">
                  Download PDF
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {page === 'dashboard' ? (
        <main className="container containerWide">
          <VentilatorDashboard />
        </main>
      ) : (
      <main className={pptMode ? 'container containerPpt' : 'container'}>
        <section className="hero">
          <h1>Generate architecture + MATLAB script from a single prompt</h1>
          <p>Enter your device idea. The system runs three agents and shows each agent's prompt and output.</p>
        </section>

        <section className="card">
          <form className="form" onSubmit={onRun}>
            <label className="label">
              User prompt
              <textarea
                className="textarea"
                value={userRequest}
                onChange={e => setUserRequest(e.target.value)}
                rows={3}
                placeholder="Describe the device you want to design..."
              />
            </label>
            <div className="formActions">
              <button className="btn" type="submit" disabled={loading || !userRequest.trim()}>
                {loading ? 'Running…' : 'Run pipeline'}
              </button>
              <button
                className="btn btnGhost"
                type="button"
                disabled={loading}
                onClick={() => {
                  setResult(null)
                  setError('')
                }}
              >
                Clear
              </button>
            </div>
          </form>
        </section>

        {error ? (
          <section className="alert" role="alert">
            <div className="alertTitle">Request failed</div>
            <pre className="alertBody">{error}</pre>
          </section>
        ) : null}

        {result ? (
          <section className="meta">
            <div className="metaRow">
              <div className="metaLabel">Request</div>
              <div className="metaValue">{result.user_request}</div>
            </div>
          </section>
        ) : null}

        <div className="stack">
          {result
            ? agents.map(a => (
                <AgentCard
                  key={a.key}
                  agentKey={a.key}
                  title={a.title}
                  data={a.data}
                  onOpenFullscreen={setFullscreen}
                />
              ))
            : null}
        </div>

        <footer className="footer">
          Backend: <code className="inlineCode">POST /api/run</code>
        </footer>
      </main>
      )}

      {fullscreen ? (
        <div className="fsOverlay" role="dialog" aria-modal="true">
          <div className={`fsModal ${fullscreen.agentKey ? `fsModal--${fullscreen.agentKey}` : ''}`}>
            <div className={`fsHeader ${fullscreen.agentKey ? `fsHeader--${fullscreen.agentKey}` : ''}`}>
              <div className="fsTitle">{fullscreen.title}</div>
              <button className="fsClose" type="button" onClick={() => setFullscreen(null)}>
                Close
              </button>
            </div>
            <div className="fsBody">
              {fullscreen.isMarkdown ? (
                <div className="md fsContent">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {String(fullscreen.content || '')}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="code fsContent">{String(fullscreen.content || '')}</pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
