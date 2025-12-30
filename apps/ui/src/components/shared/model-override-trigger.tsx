import { useState } from 'react';
import { Settings2, X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppStore } from '@/store/app-store';
import type { AgentModel, CursorModelId, PhaseModelKey } from '@automaker/types';
import { CLAUDE_MODELS, CURSOR_MODELS } from '@/components/views/board-view/shared/model-constants';

export interface ModelOverrideTriggerProps {
  /** Current effective model (from global settings or explicit override) */
  currentModel: AgentModel | CursorModelId;
  /** Callback when user selects override */
  onModelChange: (model: AgentModel | CursorModelId | null) => void;
  /** Optional: which phase this is for (shows global default) */
  phase?: PhaseModelKey;
  /** Size variants for different contexts */
  size?: 'sm' | 'md' | 'lg';
  /** Show as icon-only or with label */
  variant?: 'icon' | 'button' | 'inline';
  /** Whether the model is currently overridden from global */
  isOverridden?: boolean;
  /** Optional class name */
  className?: string;
}

function getModelLabel(modelId: AgentModel | CursorModelId): string {
  // Check Claude models
  const claudeModel = CLAUDE_MODELS.find((m) => m.id === modelId);
  if (claudeModel) return claudeModel.label;

  // Check Cursor models (without cursor- prefix)
  const cursorModel = CURSOR_MODELS.find((m) => m.id === `cursor-${modelId}`);
  if (cursorModel) return cursorModel.label;

  // Check Cursor models (with cursor- prefix)
  const cursorModelDirect = CURSOR_MODELS.find((m) => m.id === modelId);
  if (cursorModelDirect) return cursorModelDirect.label;

  return modelId;
}

export function ModelOverrideTrigger({
  currentModel,
  onModelChange,
  phase,
  size = 'sm',
  variant = 'icon',
  isOverridden = false,
  className,
}: ModelOverrideTriggerProps) {
  const [open, setOpen] = useState(false);
  const { phaseModels, enabledCursorModels } = useAppStore();

  // Get the global default for this phase
  const globalDefault = phase ? phaseModels[phase] : null;

  // Filter Cursor models to only show enabled ones
  const availableCursorModels = CURSOR_MODELS.filter((model) => {
    const cursorId = model.id.replace('cursor-', '') as CursorModelId;
    return enabledCursorModels.includes(cursorId);
  });

  const handleSelect = (model: AgentModel | CursorModelId) => {
    onModelChange(model);
    setOpen(false);
  };

  const handleClear = () => {
    onModelChange(null);
    setOpen(false);
  };

  // Size classes
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-10 w-10',
  };

  const iconSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === 'icon' ? (
          <button
            className={cn(
              'relative rounded-md flex items-center justify-center',
              'transition-colors duration-150',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-accent/50',
              sizeClasses[size],
              className
            )}
            title={`Model: ${getModelLabel(currentModel)}${isOverridden ? ' (overridden)' : ''}`}
          >
            <Settings2 className={iconSizes[size]} />
            {isOverridden && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-brand-500 rounded-full" />
            )}
          </button>
        ) : variant === 'button' ? (
          <Button
            variant="outline"
            size={size === 'md' ? 'default' : size}
            className={cn('gap-2', className)}
          >
            <Settings2 className={iconSizes[size]} />
            <span className="text-xs">{getModelLabel(currentModel)}</span>
            {isOverridden && <div className="w-1.5 h-1.5 bg-brand-500 rounded-full" />}
          </Button>
        ) : (
          <button
            className={cn(
              'inline-flex items-center gap-1.5 text-xs',
              'text-muted-foreground hover:text-foreground',
              'transition-colors duration-150',
              className
            )}
          >
            <span>Using {getModelLabel(currentModel)}</span>
            <Settings2 className="w-3 h-3" />
            {isOverridden && <div className="w-1.5 h-1.5 bg-brand-500 rounded-full" />}
          </button>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border/50">
          <div>
            <h4 className="text-sm font-medium">Model Override</h4>
            {globalDefault && (
              <p className="text-xs text-muted-foreground">
                Default: {getModelLabel(globalDefault)}
              </p>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-3 space-y-4">
          {/* Claude Models */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Claude
            </h5>
            <div className="grid grid-cols-3 gap-2">
              {CLAUDE_MODELS.map((model) => {
                const isActive = currentModel === model.id;
                return (
                  <button
                    key={model.id}
                    onClick={() => handleSelect(model.id as AgentModel)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-medium text-center',
                      'transition-all duration-150',
                      isActive
                        ? ['bg-brand-500/20 text-brand-500', 'border border-brand-500/40']
                        : [
                            'bg-accent/50 text-muted-foreground',
                            'border border-transparent',
                            'hover:bg-accent hover:text-foreground',
                          ]
                    )}
                  >
                    {model.label.replace('Claude ', '')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cursor Models */}
          {availableCursorModels.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Cursor
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {availableCursorModels.slice(0, 6).map((model) => {
                  const cursorId = model.id.replace('cursor-', '') as CursorModelId;
                  const isActive = currentModel === cursorId;
                  return (
                    <button
                      key={model.id}
                      onClick={() => handleSelect(cursorId)}
                      className={cn(
                        'px-3 py-2 rounded-lg text-xs font-medium text-center truncate',
                        'transition-all duration-150',
                        isActive
                          ? ['bg-purple-500/20 text-purple-400', 'border border-purple-500/40']
                          : [
                              'bg-accent/50 text-muted-foreground',
                              'border border-transparent',
                              'hover:bg-accent hover:text-foreground',
                            ]
                      )}
                      title={model.description}
                    >
                      {model.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isOverridden && (
          <div className="p-3 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="w-full gap-2 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Use Global Default
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
