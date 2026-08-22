import React, { useState } from 'react';
import { GameSettings } from '../types/game';
import { stateManager } from '../core/StateManager';
import { i18n } from '../core/Localization';
import { soundEngine } from '../audio/SoundEngine';
import { X, Settings, Volume2, Music, Eye, Sliders, RotateCcw, Download, Upload, Check } from 'lucide-react';

interface SettingsModalProps {
  onClose: () => void;
  onLanguageChanged?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onLanguageChanged }) => {
  const [settings, setSettings] = useState<GameSettings>(stateManager.getState().settings);
  const [importStr, setImportStr] = useState<string>('');
  const [importMsg, setImportMsg] = useState<string>('');
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);

  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    stateManager.updateSettings({ [key]: value });

    if (key === 'soundVolume') {
      soundEngine.setSfxVolume(value as number);
    } else if (key === 'musicVolume') {
      soundEngine.setBgmVolume(value as number);
    } else if (key === 'language') {
      if (onLanguageChanged) onLanguageChanged();
    }
  };

  const handleExport = () => {
    const b64 = stateManager.exportSave();
    navigator.clipboard.writeText(b64);
    setImportMsg('Сохранение скопировано в буфер обмена!');
    setTimeout(() => setImportMsg(''), 3000);
  };

  const handleImport = () => {
    if (!importStr.trim()) return;
    const ok = stateManager.importSave(importStr.trim());
    if (ok) {
      setSettings(stateManager.getState().settings);
      setImportMsg('Сохранение успешно загружено!');
      setTimeout(() => setImportMsg(''), 3000);
      if (onLanguageChanged) onLanguageChanged();
    } else {
      setImportMsg('Ошибка: неверный формат данных сохранения.');
    }
  };

  const handleReset = () => {
    stateManager.resetProgress();
    setSettings(stateManager.getState().settings);
    setShowResetConfirm(false);
    if (onLanguageChanged) onLanguageChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md select-none animate-fade-in">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center">
          <h2 className="font-orbitron font-extrabold text-lg text-white tracking-wider flex items-center gap-2">
            <Settings className="w-5 h-5 text-cyan-400" />
            <span>{i18n.t('settingsTitle')}</span>
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* Language Toggle */}
          <div className="flex justify-between items-center pb-3 border-b border-slate-800">
            <div>
              <h4 className="font-orbitron font-bold text-white">{i18n.t('language')}</h4>
              <p className="text-xs text-slate-400">RU (Русский) / EN (English)</p>
            </div>
            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => updateSetting('language', 'ru')}
                className={`px-3 py-1.5 rounded-lg font-orbitron font-bold text-xs transition-all cursor-pointer ${
                  settings.language === 'ru' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                Русский
              </button>
              <button
                onClick={() => updateSetting('language', 'en')}
                className={`px-3 py-1.5 rounded-lg font-orbitron font-bold text-xs transition-all cursor-pointer ${
                  settings.language === 'en' ? 'bg-cyan-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Sound & Music Sliders */}
          <div className="space-y-3 pb-3 border-b border-slate-800">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-300 flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-cyan-400" />
                <span>{i18n.t('soundVol')}</span>
              </span>
              <span className="font-mono text-cyan-400 font-bold">{Math.round(settings.soundVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.soundVolume}
              onChange={(e) => updateSetting('soundVolume', parseFloat(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />

            <div className="flex justify-between items-center mt-2">
              <span className="font-orbitron font-medium text-slate-300 flex items-center gap-2">
                <Music className="w-4 h-4 text-purple-400" />
                <span>{i18n.t('musicVol')}</span>
              </span>
              <span className="font-mono text-purple-400 font-bold">{Math.round(settings.musicVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.musicVolume}
              onChange={(e) => updateSetting('musicVolume', parseFloat(e.target.value))}
              className="w-full accent-purple-400 cursor-pointer"
            />
          </div>

          {/* Graphics Quality */}
          <div className="space-y-3 pb-3 border-b border-slate-800">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-300 flex items-center gap-2">
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>{i18n.t('graphics')}</span>
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['high', 'medium', 'low'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => updateSetting('graphicsQuality', q)}
                  className={`py-2 rounded-xl font-orbitron font-bold text-xs uppercase transition-all cursor-pointer ${
                    settings.graphicsQuality === q
                      ? 'bg-cyan-500 text-slate-950 shadow'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Checkboxes for FX */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableShadows}
                  onChange={(e) => updateSetting('enableShadows', e.target.checked)}
                  className="accent-cyan-400 rounded"
                />
                <span>{i18n.t('shadows')}</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableScreenShake}
                  onChange={(e) => updateSetting('enableScreenShake', e.target.checked)}
                  className="accent-cyan-400 rounded"
                />
                <span>{i18n.t('screenShake')}</span>
              </label>
            </div>
          </div>

          {/* Controls Sensitivity */}
          <div className="space-y-3 pb-3 border-b border-slate-800">
            <div className="flex justify-between items-center">
              <span className="font-orbitron font-medium text-slate-300 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>{i18n.t('sensitivity')}</span>
              </span>
              <span className="font-mono text-cyan-400 font-bold">{settings.controlsSensitivity.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={settings.controlsSensitivity}
              onChange={(e) => updateSetting('controlsSensitivity', parseFloat(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Save Management */}
          <div className="space-y-3">
            <h4 className="font-orbitron font-bold text-white text-xs uppercase tracking-wider">
              {i18n.t('exportSave')} / {i18n.t('importSave')}
            </h4>

            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{i18n.t('exportSave')}</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Вставьте код сохранения..."
                value={importStr}
                onChange={(e) => setImportStr(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
              <button
                onClick={handleImport}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-orbitron text-xs flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{i18n.t('importSave')}</span>
              </button>
            </div>

            {importMsg && (
              <p className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                <span>{importMsg}</span>
              </p>
            )}

            {/* Reset Progress */}
            <div className="pt-3 border-t border-slate-800">
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full py-2 border border-red-500/40 hover:bg-red-500/10 text-red-400 rounded-xl font-orbitron text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{i18n.t('resetProgress')}</span>
                </button>
              ) : (
                <div className="bg-red-950/50 border border-red-500/60 p-3 rounded-xl space-y-2">
                  <p className="text-xs text-red-300 leading-relaxed">{i18n.t('resetConfirm')}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleReset}
                      className="flex-1 py-1.5 bg-red-600 hover:bg-red-500 text-white font-orbitron font-bold text-xs rounded-lg cursor-pointer"
                    >
                      ДА, СБРОСИТЬ
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="flex-1 py-1.5 bg-slate-800 text-slate-300 font-orbitron text-xs rounded-lg cursor-pointer"
                    >
                      ОТМЕНА
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
