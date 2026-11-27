import { useRef, useState } from "react";
import { Center } from "@plugins/primitives/plugins/css/plugins/center/web";
import { Text } from "@plugins/primitives/plugins/css/plugins/text/web";
import { Loading } from "@plugins/primitives/plugins/loading/web";
import { useAssetSrc } from "@plugins/infra/plugins/endpoints/web";
import { MediaPlayer } from "@plugins/media/plugins/player/web";
import { track } from "@plugins/apps/plugins/deploy/plugins/analytics/plugins/collect/web";
import { showcaseFilm } from "@plugins/apps/plugins/website/plugins/media/core";
import { landingPane } from "@plugins/apps/plugins/website/plugins/shell/web";
import { useRevealOnActive } from "@plugins/primitives/plugins/dom/plugins/scroll-reveal/web";

/** The film's width: the whole band, capped narrower than the reading measure. */
const WIDTH = "w-full max-w-[45rem]";
/** The film's box: a 16:9 frame of that width. */
const FRAME = "w-full aspect-video rounded-xl";

/** The landing page's `;film=` value that opens it on the film, playing. */
const PLAY_FILM = "play";

/**
 * The showcase film, between the lede and the properties: the poster (a frame
 * of the film's desktop) with the player's own big play button, then the
 * themed player. Its bytes are the website-media mirror's (`apps/website/media`),
 * never git.
 *
 * The poster is decoration: until it resolves (or if it cannot) the player
 * shows the film's first frame instead, so only the film's own state is
 * rendered as one.
 *
 * Opened as `;film=play` (the README's Watch the film link), the page scrolls
 * the film to the middle of the screen and plays it — muted where the browser
 * refuses sound to a visitor who has not clicked on the page yet.
 */
export function HeroFilm() {
  const { film } = landingPane.useParams();
  const playFilm = film === PLAY_FILM;
  const revealRef = useRevealOnActive(playFilm, {
    revealOnMount: true,
    block: "center",
  });
  return (
    <div ref={revealRef} className={WIDTH}>
      <FilmPlayer autoPlay={playFilm} />
    </div>
  );
}

function FilmPlayer({ autoPlay }: { autoPlay: boolean }) {
  const video = useAssetSrc(showcaseFilm.video);
  const poster = useAssetSrc(showcaseFilm.poster);
  const [failed, setFailed] = useState<string | null>(null);
  // The first play only: a pause and resume is the same viewing.
  const played = useRef(false);

  if (video.kind === "loading")
    return <Loading variant="block" className={FRAME} />;
  if (video.kind !== "ready") return <FilmProblem message={video.message} />;
  if (failed !== null) return <FilmProblem message={failed} />;
  return (
    <MediaPlayer
      kind="video"
      src={video.src}
      keep="hero-film"
      poster={poster.kind === "ready" ? poster.src : undefined}
      label={showcaseFilm.label}
      autoPlay={autoPlay}
      onPlay={() => {
        if (played.current) return;
        played.current = true;
        track("hero_film_play");
      }}
      onError={(error) =>
        setFailed(
          `The film could not be played${error?.message ? `: ${error.message}` : "."}`,
        )
      }
      className={FRAME}
    />
  );
}

/** What stands in the film's frame when it cannot be shown, saying why. */
function FilmProblem({ message }: { message: string }) {
  return (
    <Center className={`${FRAME} border border-border`}>
      <Text tone="muted">{message}</Text>
    </Center>
  );
}
