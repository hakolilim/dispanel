import { useState } from "react";
import { cn } from "@/lib/utils";

const CUSTOM_EMOJI_PATTERN = /<(a?):([A-Za-z0-9_]+):(\d+)>/g;

interface DiscordMessageContentProps {
  content: string;
  className?: string;
}

interface DiscordEmojiProps {
  animated: boolean;
  id: string;
  name: string;
  raw: string;
}

function DiscordEmoji({ animated, id, name, raw }: DiscordEmojiProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <>{raw}</>;
  }

  return (
    <img
      src={`https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48&quality=lossless`}
      alt={`:${name}:`}
      title={`:${name}:`}
      className="mx-0.5 inline-block h-[1.375em] w-[1.375em] align-[-0.3em] object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function DiscordMessageContent({ content, className }: DiscordMessageContentProps) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CUSTOM_EMOJI_PATTERN.lastIndex = 0;
  while ((match = CUSTOM_EMOJI_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const [raw, animatedMarker, name, id] = match;
    parts.push(
      <DiscordEmoji
        key={`${match.index}-${id}`}
        animated={animatedMarker === "a"}
        id={id}
        name={name}
        raw={raw}
      />,
    );
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <span className={cn("whitespace-pre-wrap break-words", className)}>{parts}</span>;
}
