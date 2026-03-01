import google.generativeai as genai
import json
import os
import pickle
from pathlib import Path
import textwrap
import re, time
import random

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# --- Configuration ---
# Gemini quota note: quotas are evaluated per Google Cloud project/account
# and apply across all models and API keys. Rotating or changing model names
# will *not* bypass a zero free‑tier quota – you must add keys on another
# project or enable billing/upgrade the plan.
#
# each agent may have one or more Gemini API keys; the code will rotate
# through the list if a quota-exhausted error occurs.
def _csv_env(name: str):
    v = os.getenv(name, "").strip()
    if not v:
        return None
    return [s.strip() for s in v.split(",") if s.strip()]

def _models_env(name: str):
    models = _csv_env(name)
    return models

API_KEYS = {
    "regulatory": _csv_env("GEMINI_KEYS_REGULATORY") or [],
    "architect" : _csv_env("GEMINI_KEYS_ARCHITECT") or [],
    "matlab"    : _csv_env("GEMINI_KEYS_MATLAB") or [],
}

_missing = [k for k, v in API_KEYS.items() if not v]
if _missing:
    raise RuntimeError(
        "Missing Gemini API keys for: "
        + ", ".join(_missing)
        + ". Set GEMINI_KEYS_REGULATORY, GEMINI_KEYS_ARCHITECT, GEMINI_KEYS_MATLAB via your .env or environment."
    )

GEMINI_MODELS_DEFAULT = _models_env("GEMINI_MODELS")

GEMINI_MODELS_REGULATORY = _models_env("GEMINI_MODEL_REGULATORY") or GEMINI_MODELS_DEFAULT
GEMINI_MODELS_ARCHITECT = _models_env("GEMINI_MODEL_ARCHITECT") or GEMINI_MODELS_DEFAULT
GEMINI_MODELS_MATLAB = _models_env("GEMINI_MODEL_MATLAB") or GEMINI_MODELS_DEFAULT

_missing_models = []
if not GEMINI_MODELS_REGULATORY:
    _missing_models.append("GEMINI_MODEL_REGULATORY or GEMINI_MODELS")
if not GEMINI_MODELS_ARCHITECT:
    _missing_models.append("GEMINI_MODEL_ARCHITECT or GEMINI_MODELS")
if not GEMINI_MODELS_MATLAB:
    _missing_models.append("GEMINI_MODEL_MATLAB or GEMINI_MODELS")
if _missing_models:
    raise RuntimeError(
        "Missing Gemini model name(s): "
        + ", ".join(_missing_models)
        + ". Provide a model name or comma-separated model list (e.g. models/gemini-2.5-flash)."
    )

# Cache directory for saving agent outputs
CACHE_DIR = Path("agent_cache")
CACHE_DIR.mkdir(exist_ok=True)

# rotate among a set of model instances built with different keys
import google.api_core.exceptions as _api_exc

class RotatingModel:
    def __init__(self, model_names, api_keys):
        if isinstance(model_names, str):
            model_names = [model_names]
        self._model_names = list(model_names)
        self._api_keys = list(api_keys)
        self._models = [genai.GenerativeModel(name) for name in self._model_names]
        self._key_index = 0
        self._model_index = 0
        self._retry_count = 0
        self._max_retries = 5
        self._max_delay_seconds = 15 * 60
        self._min_spacing_seconds = float(os.getenv("GEMINI_MIN_SPACING_SECONDS", "0"))
        self._last_call_at = 0.0

    def _is_hard_quota_exceeded(self, exc: Exception) -> bool:
        msg = str(exc).lower()
        # Hard quota/billing exhaustion typically won't resolve via retry.
        return (
            "exceeded your current quota" in msg
            or "check your plan" in msg
            or "billing" in msg
        )

    def _sleep_with_jitter(self, delay_seconds: float) -> None:
        # Full jitter (AWS-style): random between 0 and delay.
        d = max(0.0, float(delay_seconds))
        jittered = random.uniform(0.0, d)
        time.sleep(jittered)

    def _extract_retry_delay(self, exc: _api_exc.ResourceExhausted) -> float:
        """Extract retry delay from exception, return None if not found."""
        # Try to extract from error message text
        m = re.search(r"retry in ([0-9]+(?:\.[0-9]+)?)s", str(exc))
        if m:
            return float(m.group(1))
        # Try to extract from retry_delay field in repr
        m = re.search(r"retry_delay.*?seconds: ([0-9]+)", repr(exc))
        if m:
            return float(m.group(1))
        return None

    def generate_content(self, *args, **kwargs):
        last_exc = None
        retry_count = 0
        base_delay = 60  # Start with 60 seconds (API recommends 52.8s)
        
        while retry_count < self._max_retries:
            for attempt in range(len(self._api_keys) * len(self._models)):
                m = self._models[self._model_index]
                try:
                    # Configure the API key per-call (genai.configure is global).
                    genai.configure(api_key=self._api_keys[self._key_index])

                    # Optional throttling to reduce bursty rate-limit failures.
                    if self._min_spacing_seconds > 0:
                        now = time.time()
                        wait_for = (self._last_call_at + self._min_spacing_seconds) - now
                        if wait_for > 0:
                            time.sleep(wait_for)
                        self._last_call_at = time.time()

                    return m.generate_content(*args, **kwargs)
                except _api_exc.ResourceExhausted as e:
                    last_exc = e

                    # If this is a hard quota/billing exhaustion, don't waste time retrying.
                    if self._is_hard_quota_exceeded(e):
                        raise _api_exc.ResourceExhausted(
                            "Gemini API quota exhausted for this project/account. "
                            "Retries will not succeed until quota/billing is updated. "
                            "Check https://ai.dev/rate-limit and your billing plan.\n\n" + str(e)
                        ) from e

                    # Try to get delay from API response
                    api_delay = self._extract_retry_delay(e)
                    if api_delay:
                        delay = api_delay
                    else:
                        # Exponential backoff: 60s, 120s, 240s, 480s, 960s
                        delay = base_delay * (2 ** retry_count)

                    delay = min(float(delay), float(self._max_delay_seconds))
                    
                    print(f"⏳ Quota exhausted (attempt {retry_count + 1}/{self._max_retries}) – sleeping {delay:.1f}s then retrying...")
                    self._sleep_with_jitter(delay)
                    retry_count += 1
                    
                    # Rotate key first, then model.
                    self._key_index = (self._key_index + 1) % len(self._api_keys)
                    if self._key_index == 0:
                        self._model_index = (self._model_index + 1) % len(self._models)
                    break
            else:
                # All keys tried in this iteration, continue to next retry with backoff
                continue
        
        if last_exc:
            raise last_exc
        return self._models[0].generate_content(*args, **kwargs)

# helper that returns either a RotatingModel or plain GenerativeModel

def make_model(model_name: str, api_keys):
    if isinstance(api_keys, str):
        api_keys = [api_keys]
    if len(api_keys) > 1:
        return RotatingModel(model_name, api_keys)
    else:
        return RotatingModel(model_name, api_keys)  # still wrap to unify interface

# instantiate models for each agent
models = {
    "regulatory": make_model(GEMINI_MODELS_REGULATORY, API_KEYS["regulatory"]),
    "architect" : make_model(GEMINI_MODELS_ARCHITECT,   API_KEYS["architect"]),
    "matlab"    : make_model(GEMINI_MODELS_MATLAB, API_KEYS["matlab"]),
}

def get_cache_file(agent_name: str, user_request: str) -> Path:
    """Generate cache file path based on agent and user request."""
    # Create a simple hash of the user request
    import hashlib
    normalized = " ".join((user_request or "").strip().lower().split())
    request_hash = hashlib.md5(normalized.encode()).hexdigest()[:8]
    return CACHE_DIR / f"{agent_name}_{request_hash}.pkl"


def load_from_cache(agent_name: str, user_request: str):
    """Load cached agent output if it exists."""
    cache_file = get_cache_file(agent_name, user_request)
    if cache_file.exists():
        try:
            with open(cache_file, "rb") as f:
                cached = pickle.load(f)
                print(f"📦 Loaded cached output for Agent {agent_name.title()}")
                return cached
        except Exception as e:
            print(f"⚠️ Failed to load cache: {e}")
    return None


def save_to_cache(agent_name: str, user_request: str, output: str):
    """Save agent output to cache."""
    cache_file = get_cache_file(agent_name, user_request)
    try:
        with open(cache_file, "wb") as f:
            pickle.dump(output, f)
    except Exception as e:
        print(f"⚠️ Failed to save cache: {e}")


def _percent_overshoot(signal, target):
    if target == 0:
        return None
    peak = max(signal) if signal else None
    if peak is None:
        return None
    return max(0.0, (peak - target) / abs(target) * 100.0)


def _settling_time(time_s, signal, target, band_fraction=0.02):
    if not time_s or not signal or len(time_s) != len(signal):
        return None
    if target == 0:
        return None

    band = abs(target) * band_fraction
    lo, hi = target - band, target + band
    last_outside = None
    for t, y in zip(time_s, signal):
        if y < lo or y > hi:
            last_outside = t
    if last_outside is None:
        return float(time_s[0])
    if last_outside == time_s[-1]:
        return None
    return float(last_outside)


def _dedupe_lines_keep_order(lines):
    seen = set()
    out = []
    for ln in lines:
        if ln not in seen:
            out.append(ln)
            seen.add(ln)
    return out


def _clean_user_request_for_a1(user_request: str) -> str:
    raw = textwrap.dedent(str(user_request or "")).strip()
    if not raw:
        return ""

    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    lines = _dedupe_lines_keep_order(lines)

    # If the user pasted the agent instructions back into the input, remove them.
    banned_exact = {
        "You are an expert Medical Device Regulatory Agent with RAG access to regulatory standards.",
        "Extract critical safety constraints, target pressures, and flow rates required for this device.",
        "Return a structured Markdown REQUIREMENTS_DOCUMENT with sections and strict numerical parameters.",
    }

    # Strip common prefix first (case-insensitive; tolerate 'want' vs 'wants').
    cleaned = []
    for ln in lines:
        ln2 = re.sub(r"^the user wants? to design:\s*", "", ln, flags=re.IGNORECASE).strip()
        cleaned.append(ln2 or ln)

    # Remove exact matches (after prefix stripping).
    cleaned = [ln for ln in cleaned if ln and ln not in banned_exact]

    # Remove common instruction phrases (case-insensitive) to avoid echo/repetition.
    banned_substrings = [
        "you are an expert medical device regulatory agent",
        "rag access to regulatory standards",
        "extract critical safety constraints",
        "return a structured markdown requirements_document",
    ]
    cleaned = [
        ln
        for ln in cleaned
        if not any(sub in ln.lower() for sub in banned_substrings)
    ]

    # Prefer a single-line request to avoid ugly wrapping in the UI.
    return " ".join(cleaned).strip()


def run_validation(simulation_data, iso_limits=None):
    iso_limits = iso_limits or {}
    time_s = simulation_data.get("time_s") or []
    pressure = simulation_data.get("pressure") or []
    flow = simulation_data.get("flow") or []

    report = {
        "metrics": {
            "peak_pressure": None,
            "overshoot_percent": None,
            "settling_time_s": None,
        },
        "compliance": {
            "peak_pressure_pass": None,
            "overall_pass": None,
        },
        "limits": iso_limits,
    }

    if pressure:
        peak_p = float(max(pressure))
        report["metrics"]["peak_pressure"] = peak_p

        p_max = iso_limits.get("peak_pressure_max")
        if p_max is not None:
            report["compliance"]["peak_pressure_pass"] = bool(peak_p <= float(p_max))

        p_target = iso_limits.get("pressure_target")
        if p_target is not None:
            report["metrics"]["overshoot_percent"] = _percent_overshoot(pressure, float(p_target))
            report["metrics"]["settling_time_s"] = _settling_time(time_s, pressure, float(p_target))

    passes = [v for v in report["compliance"].values() if isinstance(v, bool)]
    report["compliance"]["overall_pass"] = all(passes) if passes else None
    return report


def _a4_check(metric_value, limit_value):
    if metric_value is None or limit_value is None:
        return "FAIL"
    try:
        return "PASS" if float(metric_value) <= float(limit_value) else "FAIL"
    except Exception:
        return "FAIL"


def run_validation_report(simulation_results: dict, iso_limits: dict) -> dict:
    simulation_results = simulation_results or {}
    iso_limits = iso_limits or {}

    checks = {
        "peak_pressure_check": _a4_check(
            simulation_results.get("peak_pressure"),
            iso_limits.get("max_pressure_cmH2O"),
        ),
        "overshoot_check": _a4_check(
            simulation_results.get("overshoot_percent"),
            iso_limits.get("max_overshoot_percent"),
        ),
        "settling_time_check": _a4_check(
            simulation_results.get("settling_time_sec"),
            iso_limits.get("max_settling_time_sec"),
        ),
        "steady_state_error_check": _a4_check(
            simulation_results.get("steady_state_error_percent"),
            iso_limits.get("max_steady_state_error_percent"),
        ),
        "tidal_volume_check": _a4_check(
            simulation_results.get("tidal_volume_error_percent"),
            iso_limits.get("max_tidal_volume_error_percent"),
        ),
        "flow_rate_check": _a4_check(
            simulation_results.get("max_flow_rate_L_min"),
            iso_limits.get("max_flow_rate_L_min"),
        ),
    }

    all_pass = all(v == "PASS" for v in checks.values())

    return {
        "validation_status": "SUCCESS" if all_pass else "FAIL",
        "measured_values": {
            "peak_pressure_cmH2O": simulation_results.get("peak_pressure"),
            "overshoot_percent": simulation_results.get("overshoot_percent"),
            "settling_time_sec": simulation_results.get("settling_time_sec"),
            "steady_state_error_percent": simulation_results.get("steady_state_error_percent"),
            "tidal_volume_error_percent": simulation_results.get("tidal_volume_error_percent"),
            "flow_rate_L_min": simulation_results.get("max_flow_rate_L_min"),
        },
        "metrics_summary": checks,
        "overall_safety": "ICU Ventilator design complies with ISO safety limits."
        if all_pass
        else "ICU Ventilator design does not comply with ISO safety limits.",
        "certification_ready": bool(all_pass),
    }


def run_multi_agent_pipeline_structured(user_request: str, simulation_data=None, iso_limits=None):
    result = {
        "user_request": user_request,
        "agents": {
            "A1": {"name": "Regulatory Specialist", "prompt": None, "output": None, "from_cache": False, "type": "markdown"},
            "A2": {"name": "System Architect", "prompt": None, "output": None, "from_cache": False, "type": "json"},
            "A3": {"name": "MATLAB Coder", "prompt": None, "output": None, "from_cache": False, "type": "matlab"},
            "A4": {"name": "Validation & Verification", "prompt": None, "output": None, "from_cache": False, "type": "json"},
        },
    }

    print(f"--- Starting Pipeline for: {user_request} ---\n")

    print("🤖 Agent A1 (Regulatory Specialist) is extracting constraints...")
    user_request_clean = _clean_user_request_for_a1(user_request)

    user_request_display = user_request_clean.rstrip(".")

    prompt_lines = [
        "You are an expert Medical Device Regulatory Agent with RAG access to regulatory standards.",
        f"The user wants to design: {user_request_display}." if user_request_display else "The user wants to design:.",
        "Extract critical safety constraints, target pressures, and flow rates required for this device.",
        "Return a structured Markdown REQUIREMENTS_DOCUMENT with sections and strict numerical parameters.",
    ]
    prompt_lines = [ln.strip() for ln in prompt_lines if ln and ln.strip()]
    prompt_lines = _dedupe_lines_keep_order(prompt_lines)
    agent1_prompt = "\n".join(prompt_lines).strip() + "\n"
    result["agents"]["A1"]["prompt"] = agent1_prompt

    requirements_document = load_from_cache("A1", user_request)
    if requirements_document:
        result["agents"]["A1"]["from_cache"] = True
    else:
        agent1_response = models["regulatory"].generate_content(agent1_prompt)
        requirements_document = agent1_response.text
        save_to_cache("A1", user_request, requirements_document)
    result["agents"]["A1"]["output"] = requirements_document

    print("🤖 Agent A2 (System Architect) is designing the system hierarchy...")
    system_architecture_json = load_from_cache("A2", user_request)
    if system_architecture_json:
        result["agents"]["A2"]["from_cache"] = True
    else:
        agent2_prompt = f"""
    You are an expert System Architect. 
    Design a system architecture based ONLY on this REQUIREMENTS_DOCUMENT:
    {requirements_document}
    
    You must decompose this into 'Asset Twins' (sub-systems) and 'Component Twins' (parts).
    Return the result strictly as a JSON object with this structure:
    {{
      \"device_name\": \"string\",
      \"assets\": [
        {{
          \"asset_name\": \"string\",
          \"components\": [
            {{
              \"name\": \"string\",
              \"simscape_block_type\": \"string\",
              \"mathematical_parameters\": {{\"param1\": \"value1\"}}
            }}
          ]
        }}
      ]
    }}
    """
        result["agents"]["A2"]["prompt"] = agent2_prompt
        agent2_response = models["architect"].generate_content(
            agent2_prompt,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json"
            ),
        )
        system_architecture_json = agent2_response.text
        save_to_cache("A2", user_request, system_architecture_json)
    result["agents"]["A2"]["output"] = system_architecture_json

    print("🤖 Agent A3 (MATLAB Coder) is writing the Simulink script...")
    matlab_build_script = load_from_cache("A3", user_request)
    if matlab_build_script:
        result["agents"]["A3"]["from_cache"] = True
    else:
        agent3_prompt = f"""
    You are an expert MATLAB/Simulink automation engineer.
    Take the following JSON system architecture and write a MATLAB (.m) script 
    that programmatically builds this model using 'new_system', 'add_block', and 'set_param'.
    
    Architecture JSON:
    {system_architecture_json}
    
    Return ONLY valid MATLAB code. Do not include Markdown blocks like ```matlab.
    """
        result["agents"]["A3"]["prompt"] = agent3_prompt
        agent3_response = models["matlab"].generate_content(agent3_prompt)
        matlab_build_script = agent3_response.text
        matlab_build_script = matlab_build_script.replace("```matlab\n", "").replace("```", "")
        save_to_cache("A3", user_request, matlab_build_script)
    result["agents"]["A3"]["output"] = matlab_build_script

    if simulation_data is not None:
        a4_prompt = """You are Agent A4 – Validation & Verification Agent for a safety-critical ICU Ventilator Digital Twin.

Your job is to:

1. Analyze MATLAB simulation results.
2. Compare performance metrics against ISO safety limits.
3. Decide PASS or FAIL.
4. Return a structured JSON validation report.
5. Do NOT redesign the system.
6. Do NOT generate architecture.
7. Only validate.

Apply:

Peak Pressure ≤ ISO max pressure
Overshoot ≤ ISO max overshoot
Settling Time ≤ ISO max settling
Steady State Error ≤ ISO max SSE
Tidal Volume Error ≤ ISO limit
Flow Rate ≤ ISO limit

If ALL conditions satisfied → SUCCESS
If ANY condition violated → FAIL

Return ONLY this JSON structure:

{
  "validation_status": "SUCCESS",
  "metrics_summary": {
    "peak_pressure_check": "PASS",
    "overshoot_check": "PASS",
    "settling_time_check": "PASS",
    "steady_state_error_check": "PASS",
    "tidal_volume_check": "PASS",
    "flow_rate_check": "PASS"
  },
  "overall_safety": "ICU Ventilator design complies with ISO safety limits.",
  "certification_ready": true
}
"""
        result["agents"]["A4"]["prompt"] = a4_prompt

        sim_results = None
        if isinstance(simulation_data, dict):
            sim_results = simulation_data.get("simulation_results")
        if sim_results is not None:
            result["agents"]["A4"]["output"] = run_validation_report(sim_results, iso_limits or {})
        else:
            result["agents"]["A4"]["output"] = run_validation(simulation_data, iso_limits=iso_limits)

    return result


def run_multi_agent_pipeline(user_request):
    print(f"--- Starting Pipeline for: {user_request} ---\n")

    # =====================================================================
    # AGENT 1: The Regulatory & Requirements Agent
    # =====================================================================
    print("🤖 Agent 1 (Regulatory) is extracting constraints...")
    
    # Check cache first
    regulatory_constraints = load_from_cache("regulatory", user_request)
    
    if not regulatory_constraints:
        agent1_prompt = f"""
    You are an expert Medical Device Regulatory Agent. 
    The user wants to design: {user_request}.
    Based on general ISO 60601 and respiratory standards, extract the critical safety constraints, 
    target pressures, and flow rates required for this device.
    Keep it concise and list the strict numerical parameters.
    """
        
        try:
            agent1_response = models["regulatory"].generate_content(agent1_prompt)
        except _api_exc.ResourceExhausted as e:
            print("🚫 Agent 1 failed due to Gemini quota exhaustion.")
            print("   - Quota is shared across models and API keys in this project.")
            print("   - Add more keys via GEMINI_KEYS_REGULATORY or upgrade your plan/enable billing.")
            print("   - Alternatively wait for the free‑tier to reset or reuse cached results.")
            raise
        regulatory_constraints = agent1_response.text
        save_to_cache("regulatory", user_request, regulatory_constraints)
    
    print("\n✅ Agent 1 Output (Constraints):")
    print(regulatory_constraints)
    print("-" * 50)

    # =====================================================================
    # AGENT 2: The System Architect Agent (JSON Output)
    # =====================================================================
    print("🤖 Agent 2 (Architect) is designing the system hierarchy...")
    
    # Check cache first
    architecture_json = load_from_cache("architect", user_request)
    
    if not architecture_json:
        # We force the model to output strict JSON using generation_config
        agent2_prompt = f"""
    You are an expert System Architect. 
    Design a system architecture based ONLY on these constraints:
    {regulatory_constraints}
    
    You must decompose this into 'Asset Twins' (sub-systems) and 'Component Twins' (parts).
    Return the result strictly as a JSON object with this structure:
    {{
      "device_name": "string",
      "assets": [
        {{
          "asset_name": "string",
          "components": [
            {{
              "name": "string",
              "simscape_block_type": "string",
              "mathematical_parameters": {{"param1": "value1"}}
            }}
          ]
        }}
      ]
    }}
    """
        try:
            agent2_response = models["architect"].generate_content(
                agent2_prompt,
                generation_config=genai.GenerationConfig(
                    response_mime_type="application/json"
                )
            )
        except _api_exc.ResourceExhausted as e:
            print("🚫 Agent 2 failed due to Gemini quota exhaustion.")
            print("   - Quota is project‑wide; switching models won’t help until you add keys or upgrade.")
            print("   - You can rerun the script later after the quota resets or with billing enabled.")
            raise
        architecture_json = agent2_response.text
        save_to_cache("architect", user_request, architecture_json)
    
    print("\n✅ Agent 2 Output (Structured JSON Architecture):")
    print(architecture_json)
    print("-" * 50)

    # =====================================================================
    # AGENT 3: The MATLAB Simulink Coder Agent
    # =====================================================================
    print("🤖 Agent 3 (MATLAB Coder) is writing the Simulink script...")
    
    # Check cache first
    matlab_code = load_from_cache("matlab", user_request)
    
    if not matlab_code:
        agent3_prompt = f"""
    You are an expert MATLAB/Simulink automation engineer.
    Take the following JSON system architecture and write a MATLAB (.m) script 
    that programmatically builds this model using 'new_system', 'add_block', and 'set_param'.
    
    Architecture JSON:
    {architecture_json}
    
    Return ONLY valid MATLAB code. Do not include Markdown blocks like ```matlab.
    """
        try:
            agent3_response = models["matlab"].generate_content(agent3_prompt)
        except _api_exc.ResourceExhausted as e:
            print("🚫 Agent 3 failed due to Gemini quota exhaustion.")
            print("   - The same quota rules apply; add keys or upgrade/billing.")
            print("   - Cached outputs from prior runs may let you continue.")
            raise
        matlab_code = agent3_response.text
        
        # Clean up the output just in case the LLM adds markdown formatting
        matlab_code = matlab_code.replace("```matlab\n", "").replace("```", "")
        save_to_cache("matlab", user_request, matlab_code)
    
    print("\n✅ Agent 3 Output (MATLAB Code):")
    print(matlab_code)
    print("=" * 50)
    
    return matlab_code

# --- Run the Pipeline ---
if __name__ == "__main__":
    user_input = "A portable Class-3 Pediatric Ventilator"
    final_matlab_script = run_multi_agent_pipeline(user_input)
    
    # Save the output to a file
    with open("build_ventilator.m", "w") as f:
        f.write(final_matlab_script)
    print("\n💾 Saved final output to 'build_ventilator.m'")