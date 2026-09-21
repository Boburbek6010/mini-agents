import { useEffect, useRef, useState } from 'react';

import type { OfficeState } from '../office/engine/officeState.js';
import { getCharacterSprites, getLoadedCharacterCount } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';
import { transport } from '../transport/index.js';
import { Modal } from './ui/Modal.js';

const MASCOTS = [
  ['Detective', 'A nose for bugs'],
  ['Wizard', 'A little code magic'],
  ['Lo-fi', 'Deep work, good beats'],
  ['Chef', 'Cooking up something good'],
  ['Astronaut', 'Ready for launch'],
  ['Gardener', 'Room to grow'],
  ['Robot', 'Beep. Build. Repeat.'],
  ['Artist', 'A fresh perspective'],
  ['Pilot', 'Cleared for takeoff'],
];

function MascotSprite({ palette }: { palette: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let beat = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const sprite = getCharacterSprites(palette).walk[Direction.DOWN][beat++ % 4];
      canvas.width = sprite[0].length;
      canvas.height = sprite.length;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sprite.forEach((row, y) =>
        row.forEach((color, x) => {
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
          }
        }),
      );
    };
    draw();
    const timer = window.setInterval(draw, 240);
    return () => window.clearInterval(timer);
  }, [palette]);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: 'auto', height: 160, imageRendering: 'pixelated' }}
    />
  );
}

export function MascotPicker({
  officeState,
  onClose,
}: {
  officeState: OfficeState;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const agents = Array.from(officeState.characters.values()).filter((ch) => !ch.isSubagent);
  const [targetId, setTargetId] = useState(officeState.selectedAgentId ?? agents[0]?.id ?? null);
  const selected = targetId === null ? undefined : officeState.characters.get(targetId);
  const canPick = selected !== undefined && !selected.isSubagent;
  const choose = (palette: number) => {
    if (!canPick || !selected) return;
    selected.palette = palette;
    selected.hueShift = 0;
    for (const child of officeState.characters.values()) {
      if (child.isSubagent && child.parentAgentId === selected.id) {
        child.palette = palette;
        child.hueShift = 0;
      }
    }
    transport.send({ type: 'saveAgentSeats', seats: officeState.getPersistableSeats() });
    setPicked(palette);
  };
  return (
    <Modal isOpen onClose={onClose} title="Meet your mascots" className="mascot-modal">
      <p className="text-sm text-text-muted px-10 mt-10 mb-12">
        {canPick
          ? `Choose a character for agent ${selected.id}.`
          : 'Connect an agent to assign a mascot. You can browse all characters below.'}
      </p>
      {agents.length > 0 && (
        <label className="flex items-center gap-8 px-10 mb-12 text-sm">
          Agent
          <select
            aria-label="Agent to customize"
            value={targetId ?? ''}
            onChange={(event) => {
              setTargetId(Number(event.target.value));
              setPicked(null);
            }}
            className="bg-bg border-2 border-border py-4 px-8 text-text"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.agentName ?? `Agent ${agent.id}`} · {MASCOTS[agent.palette]?.[0] ?? 'Guest'}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mascot-grid">
        {Array.from({ length: getLoadedCharacterCount() }, (_, palette) => {
          const [name, description] = MASCOTS[palette] ?? [
            `Guest ${palette + 1}`,
            'From your asset collection',
          ];
          const active = canPick && (picked ?? selected.palette) === palette;
          return (
            <button
              key={palette}
              className={`mascot-card${active ? ' mascot-card-selected' : ''}`}
              onClick={() => choose(palette)}
              disabled={!canPick}
              aria-pressed={active}
            >
              <MascotSprite palette={palette} />
              <span className="text-lg">{name}</span>
              <span className="text-xs text-text-muted">{description}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-text-muted px-10 mt-12 mb-8">
        Each mascot walks, works, reads, and reacts to your agent's activity.
      </p>
    </Modal>
  );
}
