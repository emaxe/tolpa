/**
 * AudioEngine: полностью процедурный звук и музыка на WebAudio API.
 * Никаких внешних файлов. Все SFX синтезируются осцилляторами и шумом.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;

  soundOn = true;
  musicOn = true;
  hapticsOn = true;

  /** Создаёт контекст по первому пользовательскому жесту. */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);
      // Буфер шума для ударных/взрывов
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Применяем сохранённые настройки
      this.sfxGain.gain.value = this.soundOn ? 0.8 : 0;
      if (this.musicOn) this.startMusic();
    } catch (err) {
      console.warn("[Audio] unavailable:", err);
    }
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.8 : 0;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (on) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.3,
    when = 0,
    slideTo?: number,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.3, when = 0, filterFreq = 1200): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  vibrate(pattern: number | number[]): void {
    if (!this.hapticsOn) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* noop */
    }
  }

  // ---- SFX ----
  ui(): void {
    this.ensure();
    this.tone(660, 0.07, "triangle", 0.18);
  }
  gateGood(): void {
    this.ensure();
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.22, i * 0.05));
    this.vibrate(20);
  }
  gateBad(): void {
    this.ensure();
    this.tone(220, 0.25, "sawtooth", 0.18, 0, 110);
    this.vibrate(40);
  }
  coin(): void {
    this.ensure();
    this.tone(988, 0.08, "square", 0.12);
    this.tone(1319, 0.14, "square", 0.1, 0.05);
  }
  hit(): void {
    this.ensure();
    this.noise(0.22, 0.4, 0, 900);
    this.tone(150, 0.2, "square", 0.2, 0, 60);
    this.vibrate([30, 40, 30]);
  }
  combo(n: number): void {
    this.ensure();
    this.tone(440 + Math.min(8, n) * 60, 0.09, "triangle", 0.16);
  }
  boost(): void {
    this.ensure();
    this.tone(200, 0.5, "sawtooth", 0.2, 0, 1200);
    this.noise(0.4, 0.2, 0, 2400);
    this.vibrate(50);
  }
  event(): void {
    this.ensure();
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.16, "square", 0.14, i * 0.09));
  }
  wallHit(): void {
    this.ensure();
    this.noise(0.18, 0.5, 0, 500);
    this.tone(90, 0.24, "sine", 0.5, 0, 50);
    this.vibrate(60);
  }
  wallBreak(): void {
    this.ensure();
    this.noise(0.8, 0.5, 0, 700);
    [196, 262, 330, 392, 523].forEach((f, i) => this.tone(f, 0.5, "triangle", 0.22, i * 0.07));
    this.vibrate([80, 60, 80]);
  }
  win(): void {
    this.ensure();
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, "triangle", 0.25, i * 0.11));
  }
  lose(): void {
    this.ensure();
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.35, "sawtooth", 0.15, i * 0.16));
  }
  countdown(): void {
    this.ensure();
    this.tone(440, 0.12, "square", 0.16);
  }
  go(): void {
    this.ensure();
    this.tone(880, 0.3, "square", 0.2);
    this.vibrate(30);
  }
  pickBonus(): void {
    this.ensure();
    [523, 784, 1047].forEach((f, i) => this.tone(f, 0.1, "sine", 0.22, i * 0.04));
  }
  specialist(): void {
    this.ensure();
    this.tone(700, 0.1, "square", 0.14);
    this.tone(1050, 0.16, "square", 0.14, 0.07);
  }

  // ---- Музыка: минималистичный процедурный луп ----
  private startMusic(): void {
    if (!this.ctx || !this.musicGain || this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    const bass = [110, 110, 130.8, 130.8, 98, 98, 146.8, 146.8];
    const arp = [220, 261.6, 329.6, 392, 329.6, 261.6, 440, 392];
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      const t = this.nextNoteTime;
      const b = bass[this.step % bass.length];
      const a = arp[this.step % arp.length];
      // Бас
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = b;
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.42);
      osc.connect(g).connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 0.45);
      // Арпеджио (каждая 2-я восьмая)
      if (this.step % 2 === 0) {
        const osc2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        osc2.type = "square";
        osc2.frequency.value = a;
        g2.gain.setValueAtTime(0.12, t);
        g2.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
        osc2.connect(g2).connect(this.musicGain);
        osc2.start(t);
        osc2.stop(t + 0.2);
      }
      // Хэт
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 6000;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.08, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(f).connect(ng).connect(this.musicGain);
      noise.start(t);
      noise.stop(t + 0.06);
      // Следующий шаг: 8-е ноты при 132 BPM
      this.nextNoteTime += 60 / 132 / 2;
      this.step++;
    };
    this.musicTimer = setInterval(tick, 90);
  }

  private stopMusic(): void {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  dispose(): void {
    this.stopMusic();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
