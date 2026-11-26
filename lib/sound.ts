// Realistic Cinematic Medieval Foley & Reverb Audio Engine (Web Audio API)
// Uses synthesized stereo valley impulse-response convolution reverb, dynamic master compression,
// multi-band physical modeling (stick-slip wood creaks, limestone modal impacts, tumbling masonry
// cascades, Doppler fire-whooshes, resonant brass formants, and metallic steel rings).

class StoneSoundEngine {
  private ctx: AudioContext | null = null;
  private master: DynamicsCompressorNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private sampleCache: Map<string, AudioBuffer> = new Map();
  private sampleLoading: Set<string> = new Set();
  private ambientNode: { stop: () => void } | null = null;
  public enabled = true;

  private preloadSample(name: string, url: string) {
    if (!this.ctx || this.sampleCache.has(name) || this.sampleLoading.has(name)) return;
    this.sampleLoading.add(name);
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf && this.ctx ? this.ctx.decodeAudioData(buf) : null))
      .then((decoded) => {
        if (decoded) this.sampleCache.set(name, decoded);
      })
      .catch(() => {})
      .finally(() => this.sampleLoading.delete(name));
  }

  private playSample(name: string, opts: { gain?: number; rate?: number; pan?: number; wet?: number; delay?: number } = {}): boolean {
    const ctx = this.ensure();
    if (!ctx) return false;
    const buf = this.sampleCache.get(name);
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(opts.rate ?? 1.0, ctx.currentTime + (opts.delay ?? 0));
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.65, ctx.currentTime + (opts.delay ?? 0));
    src.connect(g);
    this.route(g, opts.pan ?? 0, opts.wet ?? 0.32);
    src.start(ctx.currentTime + (opts.delay ?? 0));
    return true;
  }

  private ensure(): AudioContext | null {
    if (!this.enabled || typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;

      // Master bus with cinematic glue compression
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-14, ctx.currentTime);
      comp.knee.setValueAtTime(18, ctx.currentTime);
      comp.ratio.setValueAtTime(5, ctx.currentTime);
      comp.attack.setValueAtTime(0.004, ctx.currentTime);
      comp.release.setValueAtTime(0.18, ctx.currentTime);
      comp.connect(ctx.destination);
      this.master = comp;

      // Synthesized 2.1s stereo canyon/stone-hall reverb impulse response
      const irLen = Math.floor(ctx.sampleRate * 2.1);
      const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < irLen; i++) {
          const t = i / ctx.sampleRate;
          const env = Math.pow(1 - t / 2.1, 2.8);
          const white = Math.random() * 2 - 1;
          // Early reflections around 28ms, 62ms, 115ms + warm low-passed diffuse tail
          const damp = 0.24 + 0.55 * Math.exp(-t * 2.2);
          lp = lp * (1 - damp) + white * damp;
          let sample = lp * env * 0.45;
          if (Math.abs(t - 0.032 - ch * 0.006) < 0.002) sample += white * 0.4;
          if (Math.abs(t - 0.074 + ch * 0.008) < 0.0025) sample += white * 0.25;
          d[i] = sample;
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const revGain = ctx.createGain();
      revGain.gain.setValueAtTime(0.36, ctx.currentTime);
      conv.connect(revGain);
      revGain.connect(comp);
      this.reverb = conv;
      this.reverbGain = revGain;

      // Shared 3-second high-resolution white noise buffer
      const nLen = Math.floor(ctx.sampleRate * 3.0);
      const nb = ctx.createBuffer(1, nLen, ctx.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;

      // Preload genuine recorded real-world SFX samples (CC0/Wikimedia)
      this.preloadSample("explosion", "/sfx/explosion.ogg");
      this.preloadSample("demolish", "/sfx/demolish.ogg");
      this.preloadSample("metal_hit", "/sfx/metal_hit.mp3");
      this.preloadSample("war_horn", "/sfx/war_horn.ogg");
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private route(node: AudioNode, pan = 0, wet = 0.28) {
    const ctx = this.ctx!;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
      node.connect(panner);
      panner.connect(this.master!);
      if (wet > 0 && this.reverb) {
        const wg = ctx.createGain();
        wg.gain.setValueAtTime(wet, ctx.currentTime);
        panner.connect(wg);
        wg.connect(this.reverb);
      }
    } else {
      node.connect(this.master!);
      if (wet > 0 && this.reverb) {
        const wg = ctx.createGain();
        wg.gain.setValueAtTime(wet, ctx.currentTime);
        node.connect(wg);
        wg.connect(this.reverb);
      }
    }
  }

  private filteredNoise(opts: {
    dur: number;
    delay?: number;
    gain: number;
    attack?: number;
    filterType: BiquadFilterType;
    freqStart: number;
    freqEnd?: number;
    q?: number;
    pan?: number;
    wet?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    const flt = ctx.createBiquadFilter();
    flt.type = opts.filterType;
    flt.Q.setValueAtTime(opts.q ?? 1.0, start);
    flt.frequency.setValueAtTime(Math.max(25, opts.freqStart), start);
    if (opts.freqEnd && opts.freqEnd !== opts.freqStart) {
      flt.frequency.exponentialRampToValueAtTime(Math.max(25, opts.freqEnd), start + opts.dur);
    }

    const g = ctx.createGain();
    const atk = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(opts.gain, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0006, start + opts.dur);

    src.connect(flt);
    flt.connect(g);
    this.route(g, opts.pan ?? 0, opts.wet ?? 0.3);

    src.start(start, Math.random() * 1.5);
    src.stop(start + opts.dur + 0.05);
  }

  private bodyOsc(opts: {
    freqStart: number;
    freqEnd: number;
    dur: number;
    delay?: number;
    type: OscillatorType;
    gain: number;
    attack?: number;
    pan?: number;
    wet?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx) return;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(Math.max(20, opts.freqStart), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), start + opts.dur);

    const g = ctx.createGain();
    const atk = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(opts.gain, start + atk);
    g.gain.exponentialRampToValueAtTime(0.0006, start + opts.dur);

    osc.connect(g);
    this.route(g, opts.pan ?? 0, opts.wet ?? 0.22);
    osc.start(start);
    osc.stop(start + opts.dur + 0.03);
  }

  // ---- Optional Subtle Medieval Battlefield Ambient Wind + Fire Crackle ----
  startAmbience() {
    if (!this.enabled || this.ambientNode) return;
    const ctx = this.ensure();
    if (!ctx || !this.noiseBuf) return;

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuf;
    windSrc.loop = true;
    const windFlt = ctx.createBiquadFilter();
    windFlt.type = "bandpass";
    windFlt.frequency.setValueAtTime(310, ctx.currentTime);
    windFlt.Q.setValueAtTime(2.4, ctx.currentTime);
    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.028, ctx.currentTime);
    windSrc.connect(windFlt);
    windFlt.connect(windGain);
    windGain.connect(this.master!);
    windSrc.start();

    const crackleTimer = window.setInterval(() => {
      if (!this.enabled) return;
      if (Math.random() < 0.6) {
        this.filteredNoise({
          dur: 0.025 + Math.random() * 0.03,
          gain: 0.022 + Math.random() * 0.02,
          attack: 0.002,
          filterType: "highpass",
          freqStart: 2800 + Math.random() * 2400,
          pan: (Math.random() - 0.5) * 1.4,
          wet: 0.15,
        });
      }
    }, 240);

    this.ambientNode = {
      stop: () => {
        window.clearInterval(crackleTimer);
        try {
          windSrc.stop();
        } catch {
          /* ignore */
        }
      },
    };
  }

  stopAmbience() {
    if (this.ambientNode) {
      this.ambientNode.stop();
      this.ambientNode = null;
    }
  }

  // ---- Realistic Medieval Catapult Launch (wood creak + rope snap + crossbar thud + Doppler fire whoosh) ----
  catapultLaunch(fromSide: "left" | "right" = "left") {
    const pan = fromSide === "left" ? -0.55 : 0.55;
    // 1. Stick-slip groaning oak timber tension creak
    for (let i = 0; i < 4; i++) {
      this.filteredNoise({
        dur: 0.055,
        delay: i * 0.035,
        gain: 0.12,
        attack: 0.006,
        filterType: "bandpass",
        freqStart: 420 + i * 95,
        freqEnd: 290 + i * 60,
        q: 9,
        pan,
        wet: 0.25,
      });
    }
    // 2. Heavy timber arm slamming into the padded crossbar
    this.bodyOsc({ freqStart: 135, freqEnd: 46, dur: 0.18, delay: 0.12, type: "triangle", gain: 0.34, pan, wet: 0.3 });
    this.filteredNoise({
      dur: 0.14,
      delay: 0.12,
      gain: 0.28,
      attack: 0.003,
      filterType: "bandpass",
      freqStart: 640,
      freqEnd: 220,
      q: 1.8,
      pan,
      wet: 0.3,
    });
    // 3. Taut hemp sling whip-snap
    this.filteredNoise({
      dur: 0.09,
      delay: 0.14,
      gain: 0.22,
      attack: 0.002,
      filterType: "highpass",
      freqStart: 2200,
      freqEnd: 900,
      pan,
      wet: 0.2,
    });
    // 4. Flaming boulder roaring Doppler air whoosh arcing overhead
    this.filteredNoise({
      dur: 0.95,
      delay: 0.16,
      gain: 0.18,
      attack: 0.18,
      filterType: "bandpass",
      freqStart: 620,
      freqEnd: 210,
      q: 2.2,
      pan: 0,
      wet: 0.45,
    });
  }

  // ---- Realistic Direct Boulder Impact on Stone Tower (real explosion sample + limestone fracture + rock clatter) ----
  towerHit(targetSide: "left" | "right" = "right") {
    const pan = targetSide === "right" ? 0.55 : -0.55;
    this.playSample("explosion", { gain: 0.72, rate: 0.94 + Math.random() * 0.12, pan, wet: 0.45 });
    // Sub-bass masonry impact punch
    this.bodyOsc({ freqStart: 95, freqEnd: 28, dur: 0.42, type: "sine", gain: 0.52, attack: 0.003, pan, wet: 0.35 });
    this.bodyOsc({ freqStart: 165, freqEnd: 42, dur: 0.28, type: "triangle", gain: 0.28, attack: 0.004, pan, wet: 0.35 });

    // Explosive limestone shatter burst
    this.filteredNoise({
      dur: 0.52,
      gain: 0.44,
      attack: 0.003,
      filterType: "lowpass",
      freqStart: 2600,
      freqEnd: 240,
      q: 0.9,
      pan,
      wet: 0.52,
    });
    // Sharp rock crack transient
    this.filteredNoise({
      dur: 0.11,
      gain: 0.34,
      attack: 0.001,
      filterType: "bandpass",
      freqStart: 1650,
      freqEnd: 680,
      q: 2.4,
      pan,
      wet: 0.4,
    });
    // Fireball ignition roar
    this.filteredNoise({
      dur: 0.65,
      delay: 0.04,
      gain: 0.2,
      attack: 0.06,
      filterType: "bandpass",
      freqStart: 420,
      freqEnd: 160,
      q: 1.1,
      pan,
      wet: 0.45,
    });
    // Cascading falling limestone chips & clatter
    for (let i = 0; i < 10; i++) {
      const d = 0.14 + i * 0.055 + Math.random() * 0.04;
      this.filteredNoise({
        dur: 0.05 + Math.random() * 0.04,
        delay: d,
        gain: 0.11 * (1 - i / 13),
        attack: 0.002,
        filterType: "bandpass",
        freqStart: 850 + Math.random() * 1400,
        freqEnd: 450,
        q: 4.2,
        pan: pan + (Math.random() - 0.5) * 0.35,
        wet: 0.4,
      });
    }
  }

  // ---- Realistic Full Tower Demolition (real demolition blast + 2.2s collapsing stone avalanche + splintering beams) ----
  towerDemolish(targetSide: "left" | "right" = "right") {
    const pan = targetSide === "right" ? 0.55 : -0.55;
    this.playSample("demolish", { gain: 0.85, rate: 0.88, pan, wet: 0.55 });
    // Initial catastrophic breach blast
    this.towerHit(targetSide);

    // Deep prolonged structural collapse sub-rumble
    this.bodyOsc({ freqStart: 72, freqEnd: 22, dur: 1.5, delay: 0.05, type: "sine", gain: 0.48, attack: 0.02, pan, wet: 0.55 });
    this.filteredNoise({
      dur: 2.1,
      delay: 0.12,
      gain: 0.34,
      attack: 0.15,
      filterType: "lowpass",
      freqStart: 780,
      freqEnd: 135,
      q: 0.7,
      pan,
      wet: 0.62,
    });

    // 22 staggered tumbling granite blocks & timber snaps cascading downward
    for (let i = 0; i < 22; i++) {
      const d = 0.18 + i * 0.08 + Math.random() * 0.06;
      const weight = 1 - i / 28;
      this.filteredNoise({
        dur: 0.08 + Math.random() * 0.07,
        delay: d,
        gain: (0.16 + Math.random() * 0.08) * weight,
        attack: 0.003,
        filterType: "bandpass",
        freqStart: 320 + Math.random() * 1100,
        freqEnd: 180,
        q: 2.6,
        pan: pan + (Math.random() - 0.5) * 0.55,
        wet: 0.5,
      });
      if (i % 4 === 0) {
        // Heavy boulder thud hitting the ground
        this.bodyOsc({
          freqStart: 95 + Math.random() * 35,
          freqEnd: 30,
          dur: 0.22,
          delay: d,
          type: "triangle",
          gain: 0.22 * weight,
          pan: pan + (Math.random() - 0.5) * 0.4,
          wet: 0.45,
        });
      }
    }
  }

  // ---- Realistic Medieval Brass War Horn (real horn recording layered with canyon brass resonance) ----
  warHorn() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (this.playSample("war_horn", { gain: 0.52, rate: 0.92, pan: 0, wet: 0.58 })) {
      return;
    }
    const playHornNote = (freq: number, delay: number, dur: number) => {
      const start = ctx.currentTime + delay;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc2.type = "triangle";
      // Subtle authentic brass lip-scoop up to pitch
      osc1.frequency.setValueAtTime(freq * 0.94, start);
      osc1.frequency.exponentialRampToValueAtTime(freq, start + 0.09);
      osc2.frequency.setValueAtTime(freq * 1.995, start);
      osc2.frequency.exponentialRampToValueAtTime(freq * 2.0, start + 0.09);

      const flt = ctx.createBiquadFilter();
      flt.type = "lowpass";
      flt.frequency.setValueAtTime(freq * 2.2, start);
      flt.frequency.linearRampToValueAtTime(freq * 5.2, start + 0.18);
      flt.frequency.exponentialRampToValueAtTime(freq * 2.6, start + dur);
      flt.Q.setValueAtTime(1.8, start);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.11);
      g.gain.setValueAtTime(0.16, start + dur * 0.72);
      g.gain.exponentialRampToValueAtTime(0.0008, start + dur);

      osc1.connect(flt);
      osc2.connect(flt);
      flt.connect(g);
      this.route(g, 0, 0.58);

      osc1.start(start);
      osc2.start(start);
      osc1.stop(start + dur + 0.05);
      osc2.stop(start + dur + 0.05);

      // Subtle breath turbulence layer
      this.filteredNoise({
        dur: dur * 0.85,
        delay,
        gain: 0.032,
        attack: 0.08,
        filterType: "bandpass",
        freqStart: freq * 4.5,
        q: 3,
        wet: 0.45,
      });
    };

    playHornNote(146.83, 0, 0.48); // D3
    playHornNote(220.0, 0.36, 0.95); // A3
  }

  // ---- Realistic Stone Footstep + Harmonic Chime (Turnul Floor Climb) ----
  climbStep(floor = 1) {
    // Heavy stone boot step on staircase
    this.filteredNoise({
      dur: 0.07,
      gain: 0.14,
      attack: 0.002,
      filterType: "lowpass",
      freqStart: 620,
      freqEnd: 180,
      wet: 0.4,
    });
    // Resonant medieval bell/harp chime ascending with floor
    const scale = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0, 987.77];
    const f = scale[Math.min(Math.max(floor - 1, 0), scale.length - 1)];
    this.bodyOsc({ freqStart: f, freqEnd: f * 0.998, dur: 0.42, type: "triangle", gain: 0.14, attack: 0.005, wet: 0.5 });
    this.bodyOsc({ freqStart: f * 2, freqEnd: f * 1.995, dur: 0.28, delay: 0.04, type: "sine", gain: 0.08, attack: 0.005, wet: 0.5 });
  }

  // ---- Realistic Wood & Iron Shield Shatter ----
  shieldCrack() {
    this.bodyOsc({ freqStart: 180, freqEnd: 55, dur: 0.22, type: "triangle", gain: 0.32, attack: 0.002, wet: 0.4 });
    this.filteredNoise({
      dur: 0.28,
      gain: 0.3,
      attack: 0.002,
      filterType: "bandpass",
      freqStart: 1800,
      freqEnd: 520,
      q: 1.5,
      wet: 0.45,
    });
    // Metallic clang resonance
    this.bodyOsc({ freqStart: 910, freqEnd: 870, dur: 0.25, type: "sine", gain: 0.09, attack: 0.002, wet: 0.5 });
    this.bodyOsc({ freqStart: 1390, freqEnd: 1340, dur: 0.2, type: "triangle", gain: 0.06, attack: 0.002, wet: 0.5 });
  }

  // ---- Realistic War Drum Countdown Tick ----
  tick() {
    this.bodyOsc({ freqStart: 115, freqEnd: 62, dur: 0.12, type: "sine", gain: 0.24, attack: 0.003, wet: 0.35 });
    this.filteredNoise({
      dur: 0.04,
      gain: 0.09,
      attack: 0.002,
      filterType: "bandpass",
      freqStart: 900,
      q: 2.5,
      wet: 0.2,
    });
  }

  // ---- Realistic Steel Clash / Combat SFX ----
  slash() {
    this.filteredNoise({
      dur: 0.16,
      gain: 0.2,
      attack: 0.02,
      filterType: "bandpass",
      freqStart: 2200,
      freqEnd: 550,
      q: 2.8,
      wet: 0.3,
    });
  }
  lightHit() {
    this.bodyOsc({ freqStart: 170, freqEnd: 48, dur: 0.16, type: "triangle", gain: 0.32, attack: 0.002, wet: 0.3 });
    this.filteredNoise({ dur: 0.14, gain: 0.26, attack: 0.002, filterType: "bandpass", freqStart: 1400, freqEnd: 480, q: 1.8, wet: 0.35 });
  }
  heavyHit() {
    this.towerHit("right");
  }
  block() {
    this.playSample("metal_hit", { gain: 0.68, rate: 0.96 + Math.random() * 0.14, wet: 0.42 });
    // True inharmonic forged steel sword-clash ring
    this.bodyOsc({ freqStart: 1120, freqEnd: 1095, dur: 0.34, type: "sine", gain: 0.14, attack: 0.001, wet: 0.45 });
    this.bodyOsc({ freqStart: 1685, freqEnd: 1650, dur: 0.26, type: "triangle", gain: 0.1, attack: 0.001, wet: 0.45 });
    this.bodyOsc({ freqStart: 2540, freqEnd: 2490, dur: 0.18, type: "sine", gain: 0.07, attack: 0.001, wet: 0.45 });
    this.filteredNoise({ dur: 0.08, gain: 0.2, attack: 0.001, filterType: "highpass", freqStart: 2400, wet: 0.35 });
  }
  special() {
    this.filteredNoise({ dur: 0.55, gain: 0.26, attack: 0.05, filterType: "bandpass", freqStart: 320, freqEnd: 1600, q: 1.8, wet: 0.5 });
    this.bodyOsc({ freqStart: 140, freqEnd: 420, dur: 0.35, type: "sawtooth", gain: 0.14, wet: 0.45 });
  }
  bell() {
    this.bodyOsc({ freqStart: 440, freqEnd: 438, dur: 0.85, type: "triangle", gain: 0.18, attack: 0.003, wet: 0.58 });
    this.bodyOsc({ freqStart: 882, freqEnd: 879, dur: 0.55, type: "sine", gain: 0.1, attack: 0.003, wet: 0.58 });
    this.bodyOsc({ freqStart: 1318, freqEnd: 1312, dur: 0.38, type: "sine", gain: 0.06, attack: 0.003, wet: 0.58 });
  }
  ko() {
    this.towerDemolish("right");
  }

  // ---- Royal Medieval Brass Victory Fanfare ----
  victoryFanfare() {
    const chord = [
      { f: 293.66, d: 0, dur: 0.28 },
      { f: 369.99, d: 0.18, dur: 0.28 },
      { f: 440.0, d: 0.36, dur: 0.32 },
      { f: 587.33, d: 0.55, dur: 1.1 },
    ];
    for (const n of chord) {
      this.bodyOsc({ freqStart: n.f, freqEnd: n.f, dur: n.dur, delay: n.d, type: "sawtooth", gain: 0.1, attack: 0.04, wet: 0.58 });
      this.bodyOsc({ freqStart: n.f * 0.5, freqEnd: n.f * 0.5, dur: n.dur, delay: n.d, type: "triangle", gain: 0.12, attack: 0.04, wet: 0.58 });
    }
    // Triumphant war drum roll into final chord
    this.bodyOsc({ freqStart: 110, freqEnd: 48, dur: 0.35, delay: 0.54, type: "sine", gain: 0.32, wet: 0.45 });
  }

  invitePing() {
    this.bodyOsc({ freqStart: 587.33, freqEnd: 587.33, dur: 0.22, type: "triangle", gain: 0.12, wet: 0.45 });
    this.bodyOsc({ freqStart: 880, freqEnd: 880, dur: 0.32, delay: 0.12, type: "sine", gain: 0.12, wet: 0.45 });
  }
}

export const stoneSound = new StoneSoundEngine();
