import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { searchAniListPortraits } from "./anilist";
import { type BangumiCharacter } from "./bangumi";
import { newCharacter } from "./domain";
import { Avatar } from "./ui";

const cache = new Map<number, BangumiCharacter[]>();

export function AvatarCandidates({
  character,
  value,
  onChange,
}: {
  character: BangumiCharacter;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<BangumiCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const cached = cache.get(character.id);
    if (cached && !retry) {
      setCandidates(cached);
      setLoading(false);
      return () => controller.abort();
    }
    setCandidates([]);
    setLoading(true);
    // Let a closed preview (or StrictMode's initial cleanup) cancel before fetching.
    void Promise.resolve()
      .then(() => searchAniListPortraits(character, controller.signal))
      .then((results) => {
        if (controller.signal.aborted) return;
        cache.set(character.id, results);
        setCandidates(results);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setError(
          error instanceof Error ? error.message : "AniList 头像暂时不可用",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Works arrive separately and must not trigger another portrait lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, retry]);
  return (
    <section className="avatar-candidates" aria-label="更换头像">
      <div className="avatar-candidates-heading">
        <span>更换头像</span>
        {loading && (
          <span role="status">
            <Loader2 className="spin" size={14} />
            正在获取…
          </span>
        )}
      </div>
      <div
        className="avatar-candidates-grid"
        role="group"
        aria-label="备选头像"
      >
        {candidates.slice(0, 1).map((candidate, index) => (
          <button
            type="button"
            className="avatar-candidate"
            key={candidate.id}
            aria-pressed={value === candidate.images?.medium}
            aria-label={`使用备选头像 ${index + 1}`}
            title="点击更换头像，再次点击恢复原头像"
            onClick={() =>
              onChange(
                value === candidate.images?.medium
                  ? null
                  : candidate.images!.medium!,
              )
            }
          >
            <Avatar
              character={{
                ...newCharacter(character.name),
                avatarUrl: candidate.images!.medium!,
              }}
              size="portrait"
            />
          </button>
        ))}
      </div>
      {!loading && (error || !candidates.length) && (
        <p className="muted avatar-candidates-message">
          <span>{error ? "备选头像暂不可用" : "暂无备选头像"}</span>
          <button
            type="button"
            title={error || "重新获取备选头像"}
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </button>
        </p>
      )}
    </section>
  );
}
