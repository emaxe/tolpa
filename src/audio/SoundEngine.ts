import { SoundEffect, MusicTheme } from '../types/audio';
import { stateManager } from '../core/StateManager';

export class SoundEngine {
  private static instance: SoundEngine;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private isBgmPlaying: boolean = false;
  private bgmInterval: number | null = null;
  private currentTheme: MusicTheme = 'cyber';
  private stepBeat: number = 0;
  private isMuted: boolean = false;

  private constructor() {
    // Lazy initialize on first user interaction
  }

  public static getInstance(): SoundEngine {
    if (!SoundEngine.instance) {
      SoundEngine.instance = new SoundEngine();
    }
    return SoundEngine.instance;
  }

  public init(): void {
    if (this.ctx) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();

      const settings = stateManager.getState().settings;
      this.sfxGain.gain.value = settings.soundVolume;
      this.bgmGain.gain.value = settings.musicVolume * 0.4; // Soft background balance

      this.sfxGain.connect(this.masterGain);
      this.bgmGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  public resume(): void {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setSfxVolume(vol: number): void {
    if (this.sfxGain) {
      this.sfxGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  public setBgmVolume(vol: number): void {
    if (this.bgmGain) {
      this.bgmGain.gain.value = Math.max(0, Math.min(1, vol * 0.4));
    }
  }

  public playSound(effect: SoundEffect, pitchShift: number = 1.0): void {
    if (!this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const t = this.ctx.currentTime;

    switch (effect) {
      case 'footstep': {
        // Subtle soft noise click
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.05);

        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.05);
        break;
      }

      case 'gate_pass_positive': {
        // Bright two-tone chime (C5 -> G5)
        const notes = [523.25, 783.99];
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq * pitchShift, t + idx * 0.07);

          gain.gain.setValueAtTime(0.3, t + idx * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.07 + 0.25);

          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(t + idx * 0.07);
          osc.stop(t + idx * 0.07 + 0.25);
        });
        break;
      }

      case 'gate_pass_multiplier': {
        // Glorious arpeggio chord (C5 -> E5 -> G5 -> C6)
        const arpeggio = [523.25, 659.25, 783.99, 1046.5];
        arpeggio.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq * pitchShift, t + idx * 0.05);

          gain.gain.setValueAtTime(0.35, t + idx * 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.35);

          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(t + idx * 0.05);
          osc.stop(t + idx * 0.05 + 0.35);
        });
        break;
      }

      case 'gate_pass_negative': {
        // Buzz saw / downer pitch
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);

        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      }

      case 'mob_spawn': {
        // Cute pop/bubble
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(850 * pitchShift, t + 0.08);

        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.08);
        break;
      }

      case 'mob_death': {
        // Crunch / squish sound
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);

        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.12);
        break;
      }

      case 'mob_fall': {
        // Падение с края: нисходящий свист (whistle down) — короткий, чтобы не раздражать
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(180 * pitchShift, t + 0.25);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.25);
        break;
      }

      case 'coin_pickup': {
        // High sparkle bell
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(987.77 * pitchShift, t); // B5
        osc.frequency.exponentialRampToValueAtTime(1318.51 * pitchShift, t + 0.1); // E6

        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.15);
        break;
      }

      case 'adrenaline_activate': {
        // Powerful powerup rising synth sweep
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(900, t + 0.6);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.exponentialRampToValueAtTime(4000, t + 0.6);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.7);
        break;
      }

      case 'boss_roar': {
        // Heavy growl / bass blast
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.linearRampToValueAtTime(55, t + 0.8);

        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.9);
        break;
      }

      case 'boss_slam': {
        // Heavy boom impact
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(25, t + 0.45);

        gain.gain.setValueAtTime(0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.5);
        break;
      }

      case 'boss_laser': {
        // Sharp laser sweep — rising sawtooth with a fast attack
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.25);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.3);
        break;
      }

      case 'boss_minions': {
        // Swarm of small creatures — buzzing cluster of short high blips
        for (let i = 0; i < 6; i++) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const start = t + i * 0.07;
          osc.type = 'square';
          osc.frequency.setValueAtTime(700 + Math.random() * 500, start);
          osc.frequency.exponentialRampToValueAtTime(300, start + 0.12);

          gain.gain.setValueAtTime(0.12, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(start);
          osc.stop(start + 0.12);
        }
        break;
      }

      case 'boss_defeat': {
        // Triumphant descending fanfare — two-tone victory chime
        const sfx = this.sfxGain;
        const ctx = this.ctx;
        const notes = [520, 660, 880];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const start = t + i * 0.12;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, start);
          osc.frequency.exponentialRampToValueAtTime(freq * 0.5, start + 0.4);

          gain.gain.setValueAtTime(0.35, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);

          osc.connect(gain);
          if (sfx) gain.connect(sfx);
          osc.start(start);
          osc.stop(start + 0.45);
        });
        break;
      }

      case 'boss_hit': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(320 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);

        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.15);
        break;
      }

      case 'finish_wall_hit': {
        // Crunch impact
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.25);

        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.25);
        break;
      }

      case 'level_win': {
        // Victory Fanfare (C5 -> E5 -> G5 -> C6 -> E6 sustained)
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = 'triangle';
          const noteStart = t + idx * 0.12;
          const noteDur = idx === notes.length - 1 ? 0.8 : 0.2;

          osc.frequency.setValueAtTime(freq, noteStart);
          gain.gain.setValueAtTime(0.35, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDur);

          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(noteStart);
          osc.stop(noteStart + noteDur);
        });
        break;
      }

      case 'level_lose': {
        // Defeat downer tones
        const notes = [440, 392, 349.23, 261.63];
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.type = 'sawtooth';
          const noteStart = t + idx * 0.18;

          osc.frequency.setValueAtTime(freq, noteStart);
          gain.gain.setValueAtTime(0.25, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.35);

          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(noteStart);
          osc.stop(noteStart + 0.35);
        });
        break;
      }

      case 'button_click': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(400, t + 0.04);

        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.04);
        break;
      }

      case 'combo_ding': {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800 * pitchShift, t);

        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.2);
        break;
      }

      case 'upgrade_buy': {
        // Покупка улучшения/скина — короткий восходящий "кассовый" звоночек
        const notes = [660, 880, 1100];
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          const start = t + idx * 0.06;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq * pitchShift, start);
          gain.gain.setValueAtTime(0.22, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(start);
          osc.stop(start + 0.18);
        });
        break;
      }

      case 'obstacle_hit': {
        // Удар по препятствию — резкий металлический лязг
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(220 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.14);
        break;
      }

      case 'adrenaline_whoosh': {
        // Адреналин — быстрый восходящий свист (whoosh)
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(1600 * pitchShift, t + 0.35);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.4);
        break;
      }

      case 'formation_change': {
        // Смена формации — короткий "щелчок" с лёгким подъёмом тона
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500 * pitchShift, t);
        osc.frequency.exponentialRampToValueAtTime(900 * pitchShift, t + 0.08);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(t);
        osc.stop(t + 0.1);
        break;
      }

      case 'finish_chest_open': {
        // Открытие финального сундука — яркая восходящая "сокровищница"
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          const start = t + idx * 0.08;
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq * pitchShift, start);
          gain.gain.setValueAtTime(0.22, start);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
          osc.connect(gain);
          gain.connect(this.sfxGain!);
          osc.start(start);
          osc.stop(start + 0.25);
        });
        break;
      }

      default:
        break;
    }
  }

  public playMusic(theme: MusicTheme = 'cyber'): void {
    this.init();
    if (!this.ctx) return;
    this.currentTheme = theme;

    if (this.isBgmPlaying) return;
    this.isBgmPlaying = true;

    // Tempo: 128 BPM -> 60/128 = ~0.46875s per beat, 16th note = ~0.117s
    const beatTime = 120; // ms
    this.stepBeat = 0;

    const bassLines: Record<MusicTheme, number[]> = {
      cyber: [130.81, 130.81, 155.56, 174.61, 130.81, 130.81, 196.0, 174.61], // C, C, Eb, F, C, C, G, F
      magma: [110.0, 110.0, 130.81, 146.83, 110.0, 123.47, 130.81, 98.0], // A, A, C, D, A, B, C, G
      crystal: [146.83, 174.61, 196.0, 220.0, 174.61, 196.0, 220.0, 261.63], // D minor ethereal
      void: [98.0, 98.0, 116.54, 130.81, 98.0, 87.31, 98.0, 116.54], // G minor deep
      celestial: [164.81, 196.0, 220.0, 246.94, 220.0, 196.0, 164.81, 146.83], // E minor epic
      boss_battle: [82.41, 82.41, 98.0, 82.41, 110.0, 82.41, 123.47, 110.0], // E low intense
      menu: [130.81, 164.81, 196.0, 246.94, 220.0, 196.0, 164.81, 130.81],
    };

    const arpLines: Record<MusicTheme, number[]> = {
      cyber: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 783.99],
      magma: [440.0, 523.25, 659.25, 880.0, 659.25, 523.25, 440.0, 659.25],
      crystal: [587.33, 698.46, 880.0, 1174.66, 880.0, 698.46, 587.33, 880.0],
      void: [392.0, 466.16, 587.33, 783.99, 587.33, 466.16, 392.0, 587.33],
      celestial: [659.25, 783.99, 987.77, 1318.51, 987.77, 783.99, 659.25, 987.77],
      boss_battle: [329.63, 392.0, 493.88, 659.25, 493.88, 392.0, 329.63, 493.88],
      menu: [523.25, 659.25, 783.99, 987.77, 783.99, 659.25, 523.25, 659.25],
    };

    this.bgmInterval = window.setInterval(() => {
      if (!this.ctx || !this.isBgmPlaying || this.ctx.state === 'suspended') return;

      const t = this.ctx.currentTime;
      const step = this.stepBeat % 16;
      const bassPattern = bassLines[this.currentTheme] || bassLines.cyber;
      const arpPattern = arpLines[this.currentTheme] || arpLines.cyber;

      // 1. Kick on every 4th step (beat 0, 4, 8, 12)
      if (step % 4 === 0) {
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(140, t);
        kickOsc.frequency.exponentialRampToValueAtTime(35, t + 0.1);

        kickGain.gain.setValueAtTime(0.4, t);
        kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        kickOsc.connect(kickGain);
        kickGain.connect(this.bgmGain!);
        kickOsc.start(t);
        kickOsc.stop(t + 0.12);
      }

      // 2. Hi-hat on off-beats (step 2, 6, 10, 14)
      if (step % 2 === 0 && step % 4 !== 0) {
        const hatOsc = this.ctx.createOscillator();
        const hatGain = this.ctx.createGain();
        hatOsc.type = 'square';
        hatOsc.frequency.setValueAtTime(1200, t);

        hatGain.gain.setValueAtTime(0.06, t);
        hatGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

        hatOsc.connect(hatGain);
        hatGain.connect(this.bgmGain!);
        hatOsc.start(t);
        hatOsc.stop(t + 0.04);
      }

      // 3. Bass Synth (every 2 steps)
      if (step % 2 === 0) {
        const noteIdx = Math.floor(step / 2) % bassPattern.length;
        const bassFreq = bassPattern[noteIdx];

        const bassOsc = this.ctx.createOscillator();
        const bassFilter = this.ctx.createBiquadFilter();
        const bassGain = this.ctx.createGain();

        bassOsc.type = this.currentTheme === 'boss_battle' ? 'sawtooth' : 'triangle';
        bassOsc.frequency.setValueAtTime(bassFreq, t);

        bassFilter.type = 'lowpass';
        bassFilter.frequency.setValueAtTime(600, t);

        bassGain.gain.setValueAtTime(0.2, t);
        bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

        bassOsc.connect(bassFilter);
        bassFilter.connect(bassGain);
        bassGain.connect(this.bgmGain!);
        bassOsc.start(t);
        bassOsc.stop(t + 0.22);
      }

      // 4. Arpeggiator Lead
      const arpNote = arpPattern[step % arpPattern.length];
      const leadOsc = this.ctx.createOscillator();
      const leadGain = this.ctx.createGain();

      leadOsc.type = 'sine';
      leadOsc.frequency.setValueAtTime(arpNote, t);

      leadGain.gain.setValueAtTime(0.08, t);
      leadGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      leadOsc.connect(leadGain);
      leadGain.connect(this.bgmGain!);
      leadOsc.start(t);
      leadOsc.stop(t + 0.1);

      this.stepBeat++;
    }, beatTime);
  }

  public stopMusic(): void {
    if (this.bgmInterval !== null) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
    this.isBgmPlaying = false;
  }
}

export const soundEngine = SoundEngine.getInstance();
