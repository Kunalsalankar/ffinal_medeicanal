import google.generativeai as genai
import json
import os
import pickle
from pathlib import Path

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

import re, time
import random

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
    requirements_document = load_from_cache("A1", user_request)
    if requirements_document:
        result["agents"]["A1"]["from_cache"] = True
    else:
        agent1_prompt = f"""
    You are an expert Medical Device Regulatory Agent with RAG access to regulatory standards.
    The user wants to design: {user_request}.
    Extract critical safety constraints, target pressures, and flow rates required for this device.
    Return a structured Markdown REQUIREMENTS_DOCUMENT with sections and strict numerical parameters.
    """
        result["agents"]["A1"]["prompt"] = agent1_prompt
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