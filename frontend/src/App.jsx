import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { runPipeline } from './api.js'

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

function AgentCard({ title, data }) {
  const [open, setOpen] = useState(true)
  const prompt = data?.prompt
  const output = data?.output
  const fromCache = Boolean(data?.from_cache)
  const type = data?.type

  const promptFormatted = tryPrettyJson(prompt) ?? prompt
  const outputFormatted = tryPrettyJson(output) ?? output

  const outputIsMarkdown = type === 'markdown'

  return (
    <section className="card">
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
              <div className="panelTitle">Prompt</div>
              <pre className="code">{promptFormatted || '—'}</pre>
            </div>
            <div className="panel">
              <div className="panelTitle">Output</div>
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
  const [userRequest, setUserRequest] = useState('A portable Class-3 Pediatric Ventilator')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

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
      const r = await runPipeline(userRequest.trim())
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
        </div>
      </div>

      <main className="container">
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
          {result ? agents.map(a => <AgentCard key={a.key} title={a.title} data={a.data} />) : null}
        </div>

        <footer className="footer">
          Backend: <code className="inlineCode">POST /api/run</code>
        </footer>
      </main>
    </div>
  )
}
