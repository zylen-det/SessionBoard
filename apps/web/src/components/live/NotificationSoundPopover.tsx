import * as Popover from '@radix-ui/react-popover'
import { BellOff, BellRing, Play } from 'lucide-react'
import type { NotificationSoundSettings, SoundPreset } from '../../hooks/use-notification-sound'
import { cn } from '../../lib/utils'

interface NotificationSoundPopoverProps {
  settings: NotificationSoundSettings
  onSettingsChange: (patch: Partial<NotificationSoundSettings>) => void
  onPreview: () => void
  audioUnlocked: boolean
}

const SOUND_PRESETS: { value: SoundPreset; label: string }[] = [
  { value: 'ding', label: '\u266A Ding' },
  { value: 'chime', label: '\u266A Chime' },
  { value: 'bell', label: '\u266A Bell' },
]

export function NotificationSoundPopover({
  settings,
  onSettingsChange,
  onPreview,
  audioUnlocked,
}: NotificationSoundPopoverProps) {
  const isEnabled = settings.enabled
  // Truthful state: only surfaced when sound genuinely cannot play yet
  // (browser autoplay policy, no user gesture observed). Disappears the
  // instant the shared AudioContext resumes. No setting, no guessing.
  const showLockedHint = isEnabled && !audioUnlocked

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150 cursor-pointer"
          aria-label="Notification sound settings"
        >
          {isEnabled ? (
            <BellRing className="w-5 h-5 text-zinc-600 dark:text-zinc-300" />
          ) : (
            <BellOff className="w-5 h-5 text-zinc-400 dark:text-zinc-500" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="w-64 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl p-4 z-50"
        >
          {/* Header */}
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Notification Sound
          </h3>

          {/* Toggle row */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Sound</span>
            <button
              type="button"
              role="switch"
              aria-checked={isEnabled}
              aria-label="Sound"
              onClick={() => onSettingsChange({ enabled: !isEnabled })}
              className={cn(
                'relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer',
                isEnabled ? 'bg-zinc-700 dark:bg-zinc-300' : 'bg-zinc-300 dark:bg-zinc-700',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white dark:bg-zinc-200 transition-transform duration-150',
                  isEnabled && 'translate-x-4 dark:bg-zinc-900',
                )}
              />
            </button>
          </div>

          {/* Volume row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-300 shrink-0">Volume</span>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={100}
              step={1}
              value={Math.round(settings.volume * 100)}
              onChange={(e) =>
                onSettingsChange({ volume: Number.parseInt(e.target.value, 10) / 100 })
              }
              disabled={!isEnabled}
              className={cn(
                'w-full h-1 rounded-full appearance-none bg-zinc-200 dark:bg-zinc-700 accent-zinc-600 dark:accent-zinc-300 cursor-pointer',
                '[&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-zinc-600 dark:[&::-webkit-slider-thumb]:bg-zinc-300',
                !isEnabled && 'opacity-40 cursor-not-allowed',
              )}
            />
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 w-8 text-right">
              {Math.round(settings.volume * 100)}%
            </span>
          </div>

          {/* Sound picker */}
          <div className="flex gap-1.5 mb-3">
            {SOUND_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                disabled={!isEnabled}
                onClick={() => onSettingsChange({ sound: preset.value })}
                className={cn(
                  'flex-1 py-1.5 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer',
                  'border',
                  settings.sound === preset.value
                    ? 'ring-1 ring-zinc-400 dark:ring-zinc-500 bg-zinc-100 dark:bg-zinc-800 border-zinc-400 dark:border-zinc-500 text-zinc-900 dark:text-zinc-100'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  !isEnabled && 'opacity-40 cursor-not-allowed',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Preview button */}
          <button
            type="button"
            onClick={onPreview}
            className="flex items-center justify-center gap-2 w-full py-1.5 rounded-md text-sm bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition-colors duration-150 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            Preview
          </button>

          {showLockedHint && (
            <p className="mt-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Click anywhere on the page once to enable notification sound (your browser blocks
              audio until you interact).
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
