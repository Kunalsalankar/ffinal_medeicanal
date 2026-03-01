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

export async function runVentilatorWhatIf({ compliance, resistance, leak, rr_bpm = null, sensor_noise_pct = null, sim_pulse = 0, duration_s = 6, fs_hz = 50 }) {
  const res = await fetch('/api/ventilator/whatif', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      compliance,
      resistance,
      leak,
      rr_bpm,
      sensor_noise_pct,
      sim_pulse,
      duration_s,
      fs_hz
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }

  return res.json()
}
