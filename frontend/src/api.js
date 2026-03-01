export async function runPipeline(userRequest, { simulation_data = null, iso_limits = null } = {}) {
  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_request: userRequest,
      simulation_data,
      iso_limits
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }

  return res.json()
}
