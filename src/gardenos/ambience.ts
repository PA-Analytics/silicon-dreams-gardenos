import type { VerdictId } from './ingest.ts';

export type AmbienceZone = 'silent' | 'room' | 'corridor' | 'blackout' | 'island-day' | 'island-night';

export interface AmbienceRig {
  setZone(zone: AmbienceZone): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  playCrtRecognize(): void;
  playTapeClick(): void;
  playDuskShift(toNight: boolean): void;
  playVerdict(verdict: VerdictId): void;
  /** The desk's holograms opening: the rising whirr of a 1998 projector spinning up. */
  playHologramDeploy(): void;
  /** The signal is diverted: an electrical cut, amber static drifting right, then the boombox clicking on at the far right. */
  playDiversionGlitch(): void;
  /** A telephone ringing far inside the tower's tunnel. */
  playTunnelPhoneRing(): void;
  /** A very low harmonic that stays under the night while the Archive Seraph hangs over the tower. */
  setNightSeraph(active: boolean): void;
  setRepoMetrics(dormantScore: number, todoCount: number): void;
  dispose(): void;
}

/** Where the boombox and its TV sit relative to the visitor facing the tower: hard right. */
const BOOMBOX_PAN = 0.82;
const SERAPH_LEVEL = 0.022;

/**
 * Procedural WebAudio atmospheric bed & diegetic narrative cues.
 * Reuses GardenOS's unlocked AudioContext (supplied lazily via `getContext`) so we never spawn extra contexts.
 */
export function createAmbience(getContext: () => AudioContext | null): AmbienceRig {
  let muted = false;
  let zone: AmbienceZone = 'silent';
  let graphCtx: AudioContext | null = null;
  let master: GainNode | null = null;
  let humGain: GainNode | null = null;
  let humOsc: OscillatorNode | null = null;
  let humOsc2: OscillatorNode | null = null;
  let windGain: GainNode | null = null;
  let windFilter: BiquadFilterNode | null = null;
  let windSrc: AudioBufferSourceNode | null = null;
  let nightGain: GainNode | null = null;
  let nightOsc: OscillatorNode | null = null;
  let repoDetune = 0;
  let seraphGain: GainNode | null = null;
  let seraphOscs: OscillatorNode[] = [];
  let seraphActive = false;

  const ensureGraph = (): AudioContext | null => {
    const ac = getContext();
    if (!ac) return null;
    if (graphCtx === ac && master) return ac;

    graphCtx = ac;
    master = ac.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ac.destination);

    // 1) Interior electrical hum (CRT / fluorescent tubes)
    humGain = ac.createGain();
    humGain.gain.value = 0.0001;
    const humLp = ac.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 260;
    humOsc = ac.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.value = 60;
    humOsc2 = ac.createOscillator();
    humOsc2.type = 'sine';
    humOsc2.frequency.value = 120;
    humOsc.connect(humLp);
    humOsc2.connect(humLp);
    humLp.connect(humGain).connect(master);
    humOsc.start();
    humOsc2.start();

    // 2) Filtered looping air / high-altitude cliff wind
    const len = ac.sampleRate * 3;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04; // soft pink/brown tint
      ch[i] = last * 2.4;
    }
    windSrc = ac.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    windFilter = ac.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.9;
    windGain = ac.createGain();
    windGain.gain.value = 0.0001;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();

    // 3) Subtle distant telephone-line resonance for island night
    nightGain = ac.createGain();
    nightGain.gain.value = 0.0001;
    nightOsc = ac.createOscillator();
    nightOsc.type = 'sine';
    nightOsc.frequency.value = 146.83; // D3 gentle drone
    nightOsc.connect(nightGain).connect(master);
    nightOsc.start();

    // 4) The Seraph's presence: a low fifth under everything, with a slightly detuned octave that beats slowly
    seraphGain = ac.createGain();
    seraphGain.gain.value = 0.0001;
    const seraphLp = ac.createBiquadFilter();
    seraphLp.type = 'lowpass';
    seraphLp.frequency.value = 210;
    seraphOscs = ([[55, 'sine', 1], [82.41, 'sine', 0.7], [110.6, 'triangle', 0.45]] as const).map(([hz, type, level]) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      const g = ac.createGain();
      g.gain.value = level;
      o.connect(g).connect(seraphLp);
      o.start();
      return o;
    });
    seraphLp.connect(seraphGain).connect(master);
    if (seraphActive) seraphGain.gain.setTargetAtTime(SERAPH_LEVEL, ac.currentTime, 1.6);

    return ac;
  };

  const applyZone = (target: AmbienceZone) => {
    zone = target;
    const ac = ensureGraph();
    if (!ac || !humGain || !windGain || !windFilter || !nightGain) return;
    const now = ac.currentTime;
    const fade = target === 'blackout' ? 0.08 : 1.1;

    const levels: Record<AmbienceZone, { hum: number; wind: number; windHz: number; night: number }> = {
      silent: { hum: 0.0001, wind: 0.0001, windHz: 350, night: 0.0001 },
      room: { hum: 0.012, wind: 0.004, windHz: 240, night: 0.0001 },
      corridor: { hum: 0.026, wind: 0.007, windHz: 190, night: 0.0001 },
      blackout: { hum: 0.0001, wind: 0.0001, windHz: 140, night: 0.0001 },
      'island-day': { hum: 0.0001, wind: 0.042, windHz: 520, night: 0.0001 },
      'island-night': { hum: 0.005, wind: 0.032, windHz: 310, night: 0.016 },
    };
    const l = levels[target];
    humGain.gain.cancelScheduledValues(now);
    humGain.gain.setTargetAtTime(l.hum, now, fade * 0.35);
    windGain.gain.cancelScheduledValues(now);
    windGain.gain.setTargetAtTime(l.wind, now, fade * 0.35);
    windFilter.frequency.setTargetAtTime(l.windHz, now, fade * 0.4);
    nightGain.gain.cancelScheduledValues(now);
    nightGain.gain.setTargetAtTime(l.night, now, fade * 0.45);
  };

  const playNote = (ac: AudioContext, freq: number, at: number, dur: number, peak: number, type: OscillatorType = 'sine', dest: AudioNode | null = master) => {
    if (!dest) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.025);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.04);
  };

  /** A burst of white noise through one filter, shaped by an exponential decay of `dur` seconds. */
  const playNoise = (
    ac: AudioContext, at: number, dur: number, peak: number,
    filter: { type: BiquadFilterType; hz: number; q?: number }, dest: AudioNode,
  ) => {
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.hz;
    if (filter.q !== undefined) f.Q.value = filter.q;
    const g = ac.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at);
  };

  /** A stereo position in front of the master bus; falls back to the centre where panning is unavailable. */
  const panned = (ac: AudioContext, pan: number): { node: AudioNode; pan: AudioParam | null } => {
    if (!master) return { node: ac.destination, pan: null };
    if (typeof ac.createStereoPanner !== 'function') return { node: master, pan: null };
    const p: StereoPannerNode = ac.createStereoPanner();
    p.pan.value = pan;
    p.connect(master);
    return { node: p, pan: p.pan };
  };

  return {
    get muted() { return muted; },
    setZone: applyZone,
    setRepoMetrics(dormantScore, todoCount) {
      repoDetune = Math.min(18, Math.max(0, dormantScore * 10 + todoCount * 1.5));
      if (nightOsc && graphCtx) nightOsc.frequency.setTargetAtTime(146.83 - repoDetune * 0.7, graphCtx.currentTime, 0.5);
    },
    setMuted(m) {
      muted = m;
      const ac = ensureGraph();
      if (ac && master) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.06);
      if (!muted && zone !== 'silent') applyZone(zone);
    },
    playCrtRecognize() {
      const ac = ensureGraph();
      if (!ac || muted) return;
      const t = ac.currentTime;
      playNote(ac, 392.0, t, 0.35, 0.055, 'triangle');
      playNote(ac, 523.25, t + 0.11, 0.48, 0.055, 'triangle');
      playNote(ac, 659.25, t + 0.22, 0.65, 0.04, 'sine');
    },
    playTapeClick() {
      const ac = ensureGraph();
      if (!ac || muted || !master) return;
      const t = ac.currentTime;
      const len = Math.floor(ac.sampleRate * 0.06);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.16));
      const src = ac.createBufferSource();
      src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1650;
      const g = ac.createGain();
      g.gain.value = 0.35;
      src.connect(bp).connect(g).connect(master);
      src.start(t);
      // Warm tape motor spin-up
      playNote(ac, 140, t + 0.07, 0.32, 0.03, 'triangle');
    },
    playDuskShift(toNight) {
      const ac = ensureGraph();
      if (!ac || muted) return;
      const t = ac.currentTime;
      const chord = toNight ? [293.66, 220.0, 174.61] : [261.63, 329.63, 392.0];
      chord.forEach((hz, idx) => playNote(ac, hz, t + idx * 0.12, 1.35, 0.035, 'sine'));
    },
    playVerdict(verdict) {
      const ac = ensureGraph();
      if (!ac || muted) return;
      const t = ac.currentTime;
      const notes: Record<VerdictId, number[]> = {
        archive: [293.66, 349.23, 440.0],
        restore: [261.63, 329.63, 392.0, 523.25],
        leave: [293.66, 261.63, 220.0],
      };
      notes[verdict].forEach((hz, idx) => playNote(ac, hz, t + idx * 0.15, 0.95, 0.045, 'triangle'));
    },
    playHologramDeploy() {
      const ac = ensureGraph();
      if (!ac || muted || !master) return;
      const t = ac.currentTime;
      const dur = 1.05;
      // A motor winding up through a resonant band that opens with it, fluttering like a shutter.
      const body = ac.createOscillator();
      body.type = 'sawtooth';
      body.frequency.setValueAtTime(68, t);
      body.frequency.exponentialRampToValueAtTime(520, t + dur * 0.85);
      const octave = ac.createOscillator();
      octave.type = 'sine';
      octave.frequency.setValueAtTime(136, t);
      octave.frequency.exponentialRampToValueAtTime(1040, t + dur * 0.85);
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 2.2;
      band.frequency.setValueAtTime(280, t);
      band.frequency.exponentialRampToValueAtTime(1900, t + dur);
      const flutter = ac.createGain();
      flutter.gain.value = 0.75;
      const lfo = ac.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 23;
      const lfoDepth = ac.createGain();
      lfoDepth.gain.value = 0.25;
      lfo.connect(lfoDepth).connect(flutter.gain);
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.05, t + 0.2);
      env.gain.setValueAtTime(0.05, t + dur * 0.8);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
      body.connect(band);
      octave.connect(band);
      band.connect(flutter).connect(env).connect(master);
      for (const o of [body, octave, lfo]) { o.start(t); o.stop(t + dur + 0.35); }
      // The lamp catching: two glassy partials as the image locks.
      playNote(ac, 1318.51, t + dur * 0.82, 0.5, 0.02, 'sine');
      playNote(ac, 1975.53, t + dur * 0.9, 0.62, 0.012, 'sine');
    },
    playDiversionGlitch() {
      const ac = ensureGraph();
      if (!ac || muted || !master) return;
      const t = ac.currentTime;
      // 1) The cut: a wide snap and the mains note dropping out from under it.
      playNoise(ac, t, 0.07, 0.3, { type: 'highpass', hz: 2400 }, master);
      const drop = ac.createOscillator();
      drop.type = 'square';
      drop.frequency.setValueAtTime(96, t);
      drop.frequency.exponentialRampToValueAtTime(36, t + 0.18);
      const dropLp = ac.createBiquadFilter();
      dropLp.type = 'lowpass';
      dropLp.frequency.value = 320;
      const dropGain = ac.createGain();
      dropGain.gain.setValueAtTime(0.09, t);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      drop.connect(dropLp).connect(dropGain).connect(master);
      drop.start(t);
      drop.stop(t + 0.24);
      // 2) Amber static, sliding from the desk towards the right as the signal leaves it.
      const drift = panned(ac, -0.15);
      if (drift.pan) {
        drift.pan.setValueAtTime(-0.15, t + 0.04);
        drift.pan.linearRampToValueAtTime(BOOMBOX_PAN, t + 0.5);
      }
      playNoise(ac, t + 0.04, 0.52, 0.12, { type: 'bandpass', hz: 2600, q: 0.8 }, drift.node);
      // 3) The boombox takes it: a transport click and its motor, hard right.
      const side = panned(ac, BOOMBOX_PAN);
      playNoise(ac, t + 0.5, 0.05, 0.42, { type: 'bandpass', hz: 1650, q: 1.2 }, side.node);
      playNote(ac, 118, t + 0.51, 0.24, 0.07, 'triangle', side.node);
      playNote(ac, 140, t + 0.58, 0.36, 0.03, 'triangle', side.node);
    },
    playTunnelPhoneRing() {
      const ac = ensureGraph();
      if (!ac || muted || !master) return;
      const t = ac.currentTime + 0.02;
      // Heard from outside the tunnel: only the middle of the bell survives, with the concrete answering it.
      const out = ac.createGain();
      out.gain.value = 0.9;
      out.connect(master);
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1250;
      band.Q.value = 2.4;
      const dull = ac.createBiquadFilter();
      dull.type = 'lowpass';
      dull.frequency.value = 1900;
      const echo = ac.createDelay(0.5);
      echo.delayTime.value = 0.13;
      const feedback = ac.createGain();
      feedback.gain.value = 0.38;
      const wet = ac.createGain();
      wet.gain.value = 0.5;
      band.connect(dull).connect(out);
      dull.connect(echo);
      echo.connect(feedback).connect(echo);
      echo.connect(wet).connect(out);
      // "Ring-ring": two bursts of a two-tone bell, struck 24 times a second by the clapper.
      for (const start of [0, 0.62]) {
        const at = t + start;
        const env = ac.createGain();
        env.gain.setValueAtTime(0.0001, at);
        env.gain.exponentialRampToValueAtTime(0.05, at + 0.015);
        env.gain.setValueAtTime(0.05, at + 0.36);
        env.gain.exponentialRampToValueAtTime(0.0001, at + 0.46);
        const strike = ac.createGain();
        strike.gain.value = 0.55;
        const clapper = ac.createOscillator();
        clapper.type = 'square';
        clapper.frequency.value = 24;
        const depth = ac.createGain();
        depth.gain.value = 0.45;
        clapper.connect(depth).connect(strike.gain);
        strike.connect(env).connect(band);
        const oscs = [clapper];
        for (const hz of [1180, 1570]) {
          const o = ac.createOscillator();
          o.type = 'triangle';
          o.frequency.value = hz;
          o.connect(strike);
          oscs.push(o);
        }
        for (const o of oscs) { o.start(at); o.stop(at + 0.5); }
      }
      // Let the echo ring out, then take the whole chain (and its feedback loop) off the bus.
      window.setTimeout(() => { feedback.disconnect(); out.disconnect(); }, 3200);
    },
    setNightSeraph(active) {
      seraphActive = active;
      const ac = ensureGraph();
      if (!ac || !seraphGain) return;
      const now = ac.currentTime;
      seraphGain.gain.cancelScheduledValues(now);
      seraphGain.gain.setTargetAtTime(active ? SERAPH_LEVEL : 0.0001, now, active ? 1.6 : 0.9);
    },
    dispose() {
      try { humOsc?.stop(); humOsc2?.stop(); windSrc?.stop(); nightOsc?.stop(); for (const o of seraphOscs) o.stop(); } catch { /* already stopped */ }
      master?.disconnect();
      master = humGain = windGain = nightGain = seraphGain = null;
      humOsc = humOsc2 = nightOsc = null;
      seraphOscs = [];
      windSrc = null;
      windFilter = null;
      graphCtx = null;
    },
  };
}
