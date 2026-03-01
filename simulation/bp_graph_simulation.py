#!/usr/bin/env python3
"""
Blood Pressure Monitoring System Graph Simulation
Generates realistic BP waveform data for visualization
"""

import numpy as np
import matplotlib.pyplot as plt
import json
from datetime import datetime
import os

try:
    from scipy import signal as _signal  # type: ignore
except Exception:  # pragma: no cover
    _signal = None

class BloodPressureSimulator:
    def __init__(self):
        self.fs = 100  # Sampling frequency (Hz)
        self.duration = 30  # Simulation duration (seconds)
        self.t = np.linspace(0, self.duration, self.fs * self.duration)
        
    def generate_cuff_pressure(self, systolic=120, diastolic=80):
        """Simulate cuff pressure waveform during BP measurement"""
        # Inflation phase (0-8 seconds)
        inflation = np.zeros(int(self.fs * 8))
        inflation += np.linspace(0, 180, len(inflation))
        
        # Hold phase (8-12 seconds)
        hold = np.ones(int(self.fs * 4)) * 180
        
        # Deflation phase with oscillations (12-30 seconds)
        deflation_time = np.linspace(0, 18, int(self.fs * 18))
        deflation_pressure = 180 - deflation_time * 6
        
        # Add oscillation amplitude that peaks at MAP
        map_pressure = (systolic + 2 * diastolic) / 3
        oscillation_envelope = np.exp(-((deflation_pressure - map_pressure) ** 2) / 200)
        oscillations = oscillation_envelope * np.sin(2 * np.pi * 1.2 * deflation_time) * 8
        deflation = deflation_pressure + oscillations
        
        # Combine all phases
        cuff_pressure = np.concatenate([inflation, hold, deflation])
        return cuff_pressure[:len(self.t)]

    def _moving_average(self, x: np.ndarray, window: int) -> np.ndarray:
        if window <= 1:
            return x
        w = np.ones(int(window), dtype=float) / float(window)
        return np.convolve(x, w, mode='same')

    def _oscillation_envelope_scipy(self, cuff_pressure: np.ndarray) -> np.ndarray:
        """Extract oscillation amplitude envelope using SciPy (preferred)."""
        if _signal is None:
            raise RuntimeError('SciPy not available')

        # Bandpass filter isolates pulse oscillations during deflation.
        # Typical: 0.5–3.0 Hz.
        nyquist = self.fs / 2.0
        low = 0.5 / nyquist
        high = 3.0 / nyquist
        b, a = _signal.butter(2, [low, high], btype='band')
        oscillations = _signal.filtfilt(b, a, cuff_pressure)

        envelope = np.abs(oscillations)
        # Smooth envelope for display / peak detection.
        # window must be odd and < len(signal)
        win = int(self.fs * 0.5)
        if win % 2 == 0:
            win += 1
        win = max(5, min(win, len(envelope) - (1 - len(envelope) % 2)))
        if win >= 5 and win < len(envelope):
            envelope = _signal.savgol_filter(envelope, win, 3)
        return envelope
    
    def generate_oscillation_signal(self, systolic=120, diastolic=80):
        """Extract and normalize oscillation amplitude from cuff pressure"""
        cuff_pressure = self.generate_cuff_pressure(systolic, diastolic)

        # Preferred: SciPy-based envelope extraction
        if _signal is not None:
            envelope = self._oscillation_envelope_scipy(cuff_pressure)
        else:
            # Fallback (no SciPy): synthesize oscillations and compute envelope
            peak_idx = int(np.argmax(cuff_pressure))
            t = self.t

            base = np.sin(2 * np.pi * 1.2 * t)
            gate = np.zeros_like(t)
            gate[peak_idx:] = 1.0

            map_pressure = (systolic + 2 * diastolic) / 3.0
            env = np.exp(-((cuff_pressure - map_pressure) ** 2) / 200.0)
            osc = gate * env * base

            envelope = np.abs(osc)
            envelope = self._moving_average(envelope, window=int(self.fs * 0.6))

        mx = float(np.max(envelope))
        if mx > 0:
            envelope = envelope / mx

        return envelope * 100.0  # Scale to 0-100 arbitrary units
    
    def generate_pulse_waveform(self, systolic=120, heart_rate=72):
        """Generate arterial pulse waveform"""
        beats_per_second = heart_rate / 60
        beat_duration = 1 / beats_per_second
        
        # Single pulse template
        pulse_template = np.zeros(int(self.fs * beat_duration))
        pulse_peak = int(0.15 * len(pulse_template))
        
        # Systolic peak
        pulse_template[:pulse_peak] = np.linspace(0, 1, pulse_peak)
        
        # Dicrotic notch
        notch_start = pulse_peak
        notch_end = int(0.25 * len(pulse_template))
        pulse_template[notch_start:notch_end] = np.linspace(1, 0.7, notch_end - notch_start)
        
        # Diastolic decay
        pulse_template[notch_end:] = np.linspace(0.7, 0, len(pulse_template) - notch_end)
        
        # Repeat for duration
        num_beats = int(self.duration * beats_per_second)
        pulse_waveform = np.tile(pulse_template, max(num_beats, 1))[:len(self.t)]
        
        # Add small noise
        noise = np.random.normal(0, 0.02, len(pulse_waveform))
        pulse_waveform += noise
        
        return pulse_waveform * float(systolic)
    
    def add_measurement_noise(self, signal_data, noise_level=0.01):
        """Add realistic measurement noise"""
        noise = np.random.normal(0, noise_level * np.max(signal_data), len(signal_data))
        return signal_data + noise
    
    def simulate_measurement(self, systolic=120, diastolic=80, heart_rate=72):
        """Complete BP measurement simulation"""
        results = {
            'timestamp': datetime.now().isoformat(),
            'parameters': {
                'systolic': systolic,
                'diastolic': diastolic,
                'heart_rate': heart_rate,
                'map': round((systolic + 2 * diastolic) / 3, 1)
            },
            'waveforms': {
                'cuff_pressure': self.add_measurement_noise(
                    self.generate_cuff_pressure(systolic, diastolic)
                ).tolist(),
                'oscillation_amplitude': self.add_measurement_noise(
                    self.generate_oscillation_signal(systolic, diastolic)
                ).tolist(),
                'pulse_waveform': self.add_measurement_noise(
                    self.generate_pulse_waveform(systolic=systolic, heart_rate=heart_rate)
                ).tolist()
            },
            'time': self.t.tolist()
        }
        
        return results
    
    def plot_simulation(self, results, save_path=None):
        """Plot the simulation results"""
        fig, axes = plt.subplots(3, 1, figsize=(12, 10))
        fig.suptitle('Blood Pressure Monitoring Simulation', fontsize=16, fontweight='bold')
        
        # Cuff Pressure
        axes[0].plot(results['time'], results['waveforms']['cuff_pressure'], 
                    color='#2563eb', linewidth=2)
        axes[0].set_ylabel('Cuff Pressure (mmHg)', fontsize=12)
        axes[0].set_title('Cuff Pressure vs Time', fontsize=14, fontweight='bold')
        axes[0].grid(True, alpha=0.3)
        axes[0].set_ylim([0, 200])
        
        # Oscillation Amplitude
        axes[1].plot(results['time'], results['waveforms']['oscillation_amplitude'], 
                    color='#0d9488', linewidth=2)
        axes[1].set_ylabel('Amplitude (a.u.)', fontsize=12)
        axes[1].set_title('Oscillation Amplitude Detection', fontsize=14, fontweight='bold')
        axes[1].grid(True, alpha=0.3)
        axes[1].set_ylim([0, 120])
        
        # Pulse Waveform
        axes[2].plot(results['time'][:1000], results['waveforms']['pulse_waveform'][:1000], 
                    color='#16a34a', linewidth=1.5)
        axes[2].set_xlabel('Time (s)', fontsize=12)
        axes[2].set_ylabel('Arterial Pressure (mmHg)', fontsize=12)
        axes[2].set_title('Arterial Pulse Waveform', fontsize=14, fontweight='bold')
        axes[2].grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        if save_path:
            plt.savefig(save_path, dpi=300, bbox_inches='tight')
            print(f"Plot saved to: {save_path}")
        
        plt.show()
    
    def save_to_json(self, results, filename='bp_simulation.json'):
        """Save simulation results to JSON file"""
        output_dir = 'simulation_output'
        os.makedirs(output_dir, exist_ok=True)
        
        filepath = os.path.join(output_dir, filename)
        with open(filepath, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"Simulation data saved to: {filepath}")
        return filepath

def main():
    """Main simulation function"""
    print("🩺 Blood Pressure Monitoring System Simulation")
    print("=" * 50)
    
    # Initialize simulator
    simulator = BloodPressureSimulator()
    
    # Simulate different scenarios
    scenarios = [
        {'systolic': 120, 'diastolic': 80, 'heart_rate': 72, 'name': 'Normal'},
        {'systolic': 140, 'diastolic': 90, 'heart_rate': 85, 'name': 'Hypertension Stage 1'},
        {'systolic': 160, 'diastolic': 100, 'heart_rate': 95, 'name': 'Hypertension Stage 2'},
        {'systolic': 100, 'diastolic': 60, 'heart_rate': 65, 'name': 'Low Normal'},
    ]
    
    for scenario in scenarios:
        print(f"\n📊 Simulating: {scenario['name']}")
        print(f"   Systolic: {scenario['systolic']} mmHg")
        print(f"   Diastolic: {scenario['diastolic']} mmHg")
        print(f"   Heart Rate: {scenario['heart_rate']} bpm")
        
        # Run simulation
        results = simulator.simulate_measurement(
            scenario['systolic'], 
            scenario['diastolic'], 
            scenario['heart_rate']
        )
        
        # Save results
        filename = f"bp_simulation_{scenario['name'].lower().replace(' ', '_')}.json"
        simulator.save_to_json(results, filename)
        
        # Plot (only for first scenario to avoid too many plots)
        if scenario['name'] == 'Normal':
            plot_path = f"simulation_output/bp_simulation_plot.png"
            simulator.plot_simulation(results, plot_path)
    
    print("\n✅ Simulation complete!")
    print("📁 Results saved in 'simulation_output' directory")

if __name__ == "__main__":
    main()
